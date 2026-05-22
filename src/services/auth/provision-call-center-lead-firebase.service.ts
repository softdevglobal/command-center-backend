import admin from "firebase-admin";

import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";
import { ensureFirebaseBlackAuthUser } from "./ensure-firebase-black-auth-user.service.js";
import { ensureFirebasePinkAuthUser } from "./ensure-firebase-pink-auth-user.service.js";

/**
 * Schema mirrors BMS Black/Pink "create super admin" flows exactly:
 * { uid, email, displayName, role: "super_admin", provider: "password", createdAt, updatedAt }
 */
async function upsertSuperAdminsDoc(
  app: admin.app.App,
  firebaseUid: string,
  email: string,
  displayName: string
): Promise<void> {
  const ref = admin.firestore(app).doc(`super_admins/${firebaseUid}`);
  const snap = await ref.get();
  const now = new Date();
  await ref.set(
    {
      uid: firebaseUid,
      email: email.trim().toLowerCase(),
      displayName: displayName.trim() || email.trim(),
      role: "super_admin",
      provider: "password",
      updatedAt: now,
      ...(snap.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );
}

export type ProvisionLeadFirebaseResult = {
  blackUid?: string;
  pinkUid?: string;
  warnings: string[];
};

/**
 * Ensures Firebase Auth users exist in BMS Black (and Pink when configured) **and**
 * `super_admins/{uid}` docs so `verifyCallCenterOrTenantAdminAuth` / `verifyAdminAuth` accept them.
 *
 * Used for Command Center bootstrap users (Supabase `super_admin` / configured lead roles) who never
 * ran BMS “create super admin” in each Firebase project.
 */
export async function provisionCallCenterLeadFirebaseIdentities(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<ProvisionLeadFirebaseResult> {
  const warnings: string[] = [];
  const email = input.email.trim();
  const dn = input.displayName.trim() || email;

  let blackUid: string | undefined;
  const blackApp = getFirebaseBlackApp();
  if (!blackApp) {
    warnings.push("Firebase Black Admin SDK not configured — set FIREBASE_BLACK_* credentials.");
  } else {
    try {
      blackUid = await ensureFirebaseBlackAuthUser({
        email,
        password: input.password,
        displayName: dn,
      });
      await upsertSuperAdminsDoc(blackApp, blackUid, email, dn);
    } catch (e) {
      warnings.push(
        `Firebase Black provisioning failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  let pinkUid: string | undefined;
  const pinkApp = getFirebasePinkApp();
  if (!pinkApp) {
    warnings.push(
      "Firebase Pink Admin SDK not configured — set FIREBASE_PINK_* credentials (optional for Black-only)."
    );
  } else {
    try {
      pinkUid = await ensureFirebasePinkAuthUser({
        email,
        password: input.password,
        displayName: dn,
      });
      await upsertSuperAdminsDoc(pinkApp, pinkUid, email, dn);
    } catch (e) {
      warnings.push(
        `Firebase Pink provisioning failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return {
    ...(blackUid !== undefined ? { blackUid } : {}),
    ...(pinkUid !== undefined ? { pinkUid } : {}),
    warnings,
  };
}