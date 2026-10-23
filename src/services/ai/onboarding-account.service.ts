import admin from "firebase-admin";
import { randomBytes } from "node:crypto";
import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import { createSupabaseClient, getSupabaseProjectUrl, getSupabaseServiceRoleKey } from "../../db/supabase/supabase.client.js";
import { blackAdminEndpoint } from "../../config/black-api.js";
import { onboardingReviewNotifier } from "./onboarding-review-notification.service.js";
import { OnboardingError, type OnboardingDependencies } from "./onboarding.service.js";

export const onboardingOwnerUid = (draftId: string) => `ai-owner-${draftId.replace(/-/g, "")}`;
export function onboardingLoginUrl(product: string | undefined) {
  return product === "trade" ? `${(process.env.TRADE_ADMIN_BASE_URL?.trim() || "https://trade.bmspros.com.au").replace(/\/+$/, "")}/login` : blackAdminEndpoint("/login");
}
function productAuth(product: string | undefined) {
  const app = product === "trade" ? getFirebaseBlueApp() : product === "black" ? getFirebaseBlackApp() : null;
  if (!app) throw new OnboardingError(503, "ACCOUNT_SETUP_UNAVAILABLE", "The selected business account service is unavailable.");
  return admin.auth(app);
}

/** Never attach a caller to an unrelated existing Firebase account. */
export const prepareOnboardingOwner: NonNullable<OnboardingDependencies["prepareOwnerAccount"]> = async input => {
  const auth = productAuth(input.configuration.product);
  const uid = onboardingOwnerUid(input.draftId), email = input.configuration.business!.ownerEmail!.trim().toLowerCase();
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (error) { if ((error as {code?: string}).code !== "auth/user-not-found") throw error; }
  if (user && (user.uid !== uid || user.disabled))
    throw new OnboardingError(409, "EXISTING_ACCOUNT", "This email already has an account. Use its existing login or contact support; no password setup link was issued.");
  if (!user) {
    try {
      user = await auth.createUser({ uid, email, displayName: input.configuration.business!.ownerName!,
        password: randomBytes(48).toString("base64url"), emailVerified: false, disabled: false });
    } catch (error) {
      if (!["auth/uid-already-exists", "auth/email-already-exists"].includes((error as {code: string}).code)) throw error;
      user = await auth.getUserByEmail(email);
      if (user.uid !== uid || user.disabled) throw new OnboardingError(409, "EXISTING_ACCOUNT", "This email already belongs to another account.");
    }
  }
  if (user.email?.toLowerCase() !== email) throw new OnboardingError(409, "ACCOUNT_IDENTITY_CHANGED", "Account details changed; contact support.");
  return { uid, loginUrl: onboardingLoginUrl(input.configuration.product) };
};

/** Private action codes are stored only in a service-role table, never returned to the AI. */
export const notifyOnboardingAccount: NonNullable<OnboardingDependencies["notifyAccountSetup"]> = async input => {
  let stage = "AUTH_LOOKUP";
  try {
  const auth = productAuth(input.configuration.product);
  const user = await auth.getUser(input.ownerUid);
  if (user.uid !== onboardingOwnerUid(input.draftId) || user.disabled || user.email?.toLowerCase() !== input.configuration.business!.ownerEmail!.toLowerCase())
    throw new Error("Account setup identity mismatch.");
  const url = getSupabaseProjectUrl(), key = getSupabaseServiceRoleKey();
  if (!url || !key) throw new Error("Account invitation storage unavailable.");
  const db = createSupabaseClient(url, key);
  stage = "PUBLIC_ACCOUNT_URL";
  const base = new URL(onboardingLoginUrl(input.configuration.product)).origin;
  if (!base.startsWith("https://")) throw new Error("A public HTTPS account URL is required.");
  stage = "INVITATION_READ";
  const read = () => db.from("ai_onboarding_account_invitations").select("setup_url,owner_uid").eq("draft_id", input.draftId).eq("configuration_hash", input.configurationHash).single();
  let stored = await read();
  if (stored.error && stored.error.code !== "PGRST116") throw stored.error;
  if (!stored.data) {
    stage = "INVITATION_CLAIM";
    const claimed = await db.from("ai_onboarding_account_invitations").insert({ draft_id: input.draftId, configuration_hash: input.configurationHash, owner_uid: user.uid });
    if (claimed.error) {
      if (claimed.error.code !== "23505") throw claimed.error;
      stored = await read();
    }
  }
  if (stored.data && stored.data.owner_uid !== user.uid) throw new Error("Account invitation identity mismatch.");
  // Recover a prior attempt that claimed the private invitation row but failed
  // before generating/saving a link. No SMS/email has been sent at this point.
  if (!stored.data?.setup_url) {
    stage = "PASSWORD_LINK_CREATE";
    const firebaseLink = await auth.generatePasswordResetLink(user.email!, { url: `${base}/login` });
    const code = new URL(firebaseLink).searchParams.get("oobCode");
    if (!code) throw new Error("Password setup link unavailable.");
    const setupUrl = `${base}/account-setup#code=${encodeURIComponent(code)}`;
    stage = "INVITATION_SAVE";
    const saved = await db.from("ai_onboarding_account_invitations")
      .update({ setup_url: setupUrl }).eq("draft_id", input.draftId)
      .eq("configuration_hash", input.configurationHash).eq("owner_uid", user.uid)
      .is("setup_url", null);
    if (saved.error) throw saved.error;
    stored = await read();
  }
  stage = "INVITATION_PENDING";
  if (!stored.data?.setup_url || stored.data.owner_uid !== user.uid) throw new Error("Account invitation is pending reconciliation.");
  stage = "NOTIFICATION_LEDGER";
  const result = await onboardingReviewNotifier.notify({ draftId: input.draftId, configurationHash: `account_setup:${input.configurationHash}`,
    ownerEmail: user.email!, ...(input.configuration.business?.ownerPhone ? { ownerPhone: input.configuration.business.ownerPhone } : {}),
    reviewUrl: stored.data.setup_url, purpose: "account_setup" });
  console.info("[onboarding-account-notifications]", { draftId: input.draftId, sms: result.sms.status, email: result.email.status });
  return result;
  } catch (error) {
    const rawCode = (error as { code?: unknown } | null)?.code;
    const upstreamCode = typeof rawCode === "string" ? rawCode.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64) : "FAILED";
    const code = `ACCOUNT_${stage}_${upstreamCode}`;
    console.warn("[onboarding-account-notifications] Setup message failed", { draftId: input.draftId, stage, code });
    throw new OnboardingError(503, code, "The business account exists, but its setup messages could not complete. Contact support using the draft reference.");
  }
};
