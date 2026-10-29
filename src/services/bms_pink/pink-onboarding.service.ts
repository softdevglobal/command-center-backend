import admin from "firebase-admin";
import { z } from "zod";
import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";
import { getPinkApiBaseUrl, pinkEndpoint } from "../../config/pink-api.js";
import { OnboardingError, type OnboardingApproval } from "../ai/onboarding.service.js";
import { onboardingConfiguration, missingOnboardingInformation, type OnboardingConfiguration } from "../ai/onboarding.schemas.js";

export const pinkSubscriptionPlan = z.object({
  id: z.string().min(1), name: z.string().min(1), price: z.number().finite().nonnegative(),
  priceLabel: z.string().min(1), branches: z.number().int().positive(), staff: z.number().int().positive(),
  features: z.array(z.string()).default([]), trialDays: z.number().int().nonnegative().default(0),
  billingIntervalDays: z.union([z.literal(7), z.literal(28)]).default(28),
  plan_key: z.string().nullable().optional(), active: z.boolean().default(true), hidden: z.boolean().default(false),
});
export type PinkSubscriptionPlan = z.infer<typeof pinkSubscriptionPlan>;
export type PinkBusinessResult = { status: "ACCOUNT_CREATED"; ownerUid: string; slug: string; created: boolean };
export function pinkOnboardingLoginUrl() {
  return `${(process.env.PINK_ADMIN_BASE_URL?.trim() || getPinkApiBaseUrl()).replace(/\/+$/, "")}/login`;
}

export async function availablePinkPlans(fetcher: typeof fetch = fetch): Promise<PinkSubscriptionPlan[]> {
  try {
    const response = await fetcher(pinkEndpoint("/api/packages/public"), { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw new Error("Plan lookup failed.");
    const payload = z.object({ success: z.literal(true), plans: z.array(pinkSubscriptionPlan) }).parse(await response.json());
    const plans = payload.plans.filter(plan => plan.active && !plan.hidden);
    if (!plans.length) throw new Error("No plans available.");
    return plans;
  } catch {
    throw new OnboardingError(503, "PINK_PLANS_UNAVAILABLE", "Pink subscription options are temporarily unavailable. Retry before asking the caller to choose.");
  }
}

type ProvisioningInput = { requestId: string; configuration: OnboardingConfiguration; configurationHash: string; approval: OnboardingApproval };

/** Match Pink signup's users/{uid} contract; branch and staff setup follow login. */
export function createPinkBusinessProvisioner(deps: {
  db: admin.firestore.Firestore;
  auth: Pick<admin.auth.Auth, "getUser" | "setCustomUserClaims">;
  now?: () => Date;
}) {
  return async (input: ProvisioningInput): Promise<PinkBusinessResult> => {
    const config = onboardingConfiguration.parse(input.configuration);
    if (config.product !== "pink" || config.setupMode !== "new_business" || missingOnboardingInformation(config).length)
      throw new OnboardingError(422, "INCOMPLETE_SETUP", "Complete the Pink signup details and select a current plan first.");
    const expectedUid = `ai-owner-${input.requestId.replace(/-/g, "")}`;
    if (input.approval.ownerUid !== expectedUid || input.approval.method !== "phone_confirmation" || input.approval.configurationHash !== input.configurationHash)
      throw new OnboardingError(409, "APPROVAL_REQUIRED", "Confirm this exact Pink account setup before creating it.");
    const owner = await deps.auth.getUser(expectedUid);
    const business = config.business!;
    if (owner.disabled || owner.email?.toLowerCase() !== business.ownerEmail!.toLowerCase())
      throw new OnboardingError(409, "ACCOUNT_IDENTITY_CHANGED", "The Pink owner identity does not match this setup.");
    const db = deps.db;
    const requestRef = db.doc(`ai_onboarding_requests/${input.requestId}`);
    const userRef = db.doc(`users/${expectedUid}`);
    const planRef = db.doc(`subscription_plans/${config.pinkPlanId}`);
    const result = await db.runTransaction(async tx => {
      const [request, user, planDocument] = await tx.getAll(requestRef, userRef, planRef);
      const previous = request!.data();
      if (previous) {
        const profile = user!.data();
        if (previous.configurationHash !== input.configurationHash || previous.ownerUid !== expectedUid || previous.result?.status !== "ACCOUNT_CREATED" ||
            previous.result?.ownerUid !== expectedUid || !user!.exists || profile?.role !== "salon_owner" ||
            profile?.aiOnboardingRequestId !== input.requestId || profile?.aiOnboardingConfigurationHash !== input.configurationHash)
          throw new OnboardingError(409, "SETUP_CONFLICT", "This request belongs to another setup or needs reconciliation.");
        return { ...previous.result as PinkBusinessResult, created: false };
      }
      if (user!.exists) throw new OnboardingError(409, "EXISTING_ACCOUNT", "This Pink owner profile already exists. Review it before continuing.");
      const planData = planDocument!.data();
      const parsed = pinkSubscriptionPlan.safeParse({ ...planData, id: planRef.id });
      if (!parsed.success || !parsed.data.active || parsed.data.hidden || parsed.data.name !== config.pinkPlanName)
        throw new OnboardingError(422, "PINK_PLAN_CHANGED", "The selected Pink plan is no longer available. Read the current plans and confirm again.");
      const plan = parsed.data;
      const slugBase = business.tradingName!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "salon";
      const slug = `${slugBase}-${input.requestId.replace(/-/g, "")}`;
      const slugMatches = await tx.get(db.collection("users").where("slug", "==", slug).limit(1));
      if (!slugMatches.empty) throw new OnboardingError(409, "SLUG_CONFLICT", "The salon booking link already exists. Contact support.");
      const now = deps.now?.() ?? new Date();
      const trial = plan.trialDays > 0;
      const created: PinkBusinessResult = { status: "ACCOUNT_CREATED", ownerUid: expectedUid, slug, created: true };
      tx.create(userRef, {
        uid: expectedUid, email: owner.email, displayName: business.ownerName, role: "salon_owner", provider: "password",
        name: business.tradingName, slug, bookingEngineUrl: `${new URL(pinkOnboardingLoginUrl()).origin}/book-now/${slug}`,
        businessType: config.pinkBusinessType, abn: business.abn ?? null, businessStructure: business.businessStructure,
        gstRegistered: business.gstRegistered, state: business.state, postcode: business.postcode, timezone: business.timezone,
        locationText: business.address ? `${business.address} ${business.postcode}` : null, contactPhone: business.ownerPhone,
        plan: plan.name, price: plan.priceLabel, planId: plan.id, plan_key: plan.plan_key ?? null,
        billingIntervalDays: plan.billingIntervalDays, billingCycle: plan.billingIntervalDays === 7 ? "Weekly" : "Monthly",
        branchLimit: plan.branches, currentBranchCount: 0, branchNames: [], staffLimit: plan.staff, currentStaffCount: 0,
        status: trial ? "Free Trial Active" : "Pending Payment", accountStatus: trial ? "active_trial" : "pending_payment",
        subscriptionStatus: trial ? "trialing" : "pending", billing_status: trial ? "trialing" : "pending",
        trialDays: plan.trialDays, hasFreeTrial: trial, trial_start: trial ? now : null,
        trial_end: trial ? new Date(now.getTime() + plan.trialDays * 86400000) : null, paymentDetailsRequired: !trial,
        signupSource: "command_centre_ai", aiOnboardingRequestId: input.requestId, aiOnboardingConfigurationHash: input.configurationHash,
        createdAt: now, updatedAt: now,
      });
      tx.create(requestRef, { ownerUid: expectedUid, configurationHash: input.configurationHash, approval: input.approval, result: created, createdAt: now });
      return created;
    });
    // A retry also repairs claims if this step failed after the transaction committed.
    await deps.auth.setCustomUserClaims(expectedUid, { ...owner.customClaims, role: "salon_owner" });
    return result;
  };
}

export async function provisionPinkBusiness(input: ProvisioningInput): Promise<PinkBusinessResult> {
  const app = getFirebasePinkApp();
  if (!app) throw new OnboardingError(503, "PINK_SETUP_UNAVAILABLE", "Firebase Pink is not configured.");
  return createPinkBusinessProvisioner({ db: admin.firestore(app), auth: admin.auth(app) })(input);
}
