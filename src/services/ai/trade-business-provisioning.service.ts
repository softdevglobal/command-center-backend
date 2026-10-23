import admin from "firebase-admin";
import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import type { OnboardingApproval } from "./onboarding.service.js";
import type { OnboardingConfiguration } from "./onboarding.schemas.js";

export type TradeBusinessResult = {
  status: "PENDING_REVIEW";
  ownerUid: string;
  businessId: string;
  created: boolean;
};

function fail(message: string): never { throw new Error(message); }

/** Creates an inactive Blue tenant after verified owner approval; billing and launch remain separate. */
export async function provisionTradeBusiness(input: {
  requestId: string;
  configuration: OnboardingConfiguration;
  configurationHash: string;
  approval: OnboardingApproval;
}): Promise<TradeBusinessResult> {
  const config = input.configuration;
  if (config.product !== "trade" || config.setupMode !== "new_business" || !config.business || !config.tradeBusiness)
    fail("Trade setup is incomplete or has the wrong product.");
  const app = getFirebaseBlueApp();
  if (!app) fail("Firebase Blue is unavailable.");
  const auth = admin.auth(app), db = app.firestore();
  const owner = await auth.getUser(input.approval.ownerUid);
  const phoneConfirmed = input.approval.method === "phone_confirmation" && owner.uid === `ai-owner-${input.requestId.replace(/-/g, "")}`;
  if (owner.disabled || (!owner.emailVerified && !phoneConfirmed) || owner.email?.toLowerCase() !== config.business.ownerEmail?.toLowerCase())
    fail("The approved Trade owner must verify their email before provisioning.");

  const requestRef = db.doc(`ai_onboarding_requests/${input.requestId}`);
  const businessRef = db.collection("businesses").doc(`ai-${input.requestId.replace(/-/g, "").slice(0, 20)}`);
  const userRef = db.collection("users").doc(owner.uid);
  const business = config.business;
  const trade = config.tradeBusiness;
  const base = (process.env.TRADE_ADMIN_BASE_URL?.trim() || "https://trade.bmspros.com.au").replace(/\/+$/, "");
  let planResponse: Response;
  try { planResponse = await fetch(`${base}/api/packages/public`, { signal: AbortSignal.timeout(5000), redirect: "error" }); }
  catch { fail("Trade subscription plans could not be verified."); }
  if (!planResponse.ok) fail("Trade subscription plans could not be verified.");
  const planPayload = await planResponse.json().catch(() => null) as { ok?: unknown; plans?: unknown } | null;
  const selectedPlan = planPayload?.ok === true && Array.isArray(planPayload.plans)
    ? planPayload.plans.find((plan): plan is { id: string; name: string; priceLabel: string; staff?: number; features?: string[]; trialDays?: number; billingCycle?: string; validityDays?: number } =>
      !!plan && typeof plan === "object" && (plan as { id?: unknown }).id === config.tradePlanId &&
      typeof (plan as { name?: unknown }).name === "string" && typeof (plan as { priceLabel?: unknown }).priceLabel === "string")
    : undefined;
  if (!selectedPlan || selectedPlan.name !== config.tradePlanName) fail("The selected Trade subscription plan is no longer available. Refresh the plan choices and confirm again.");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const businessName = business.tradingName!;
  const slugBase = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
  const bookingSlug = `${slugBase}-${input.requestId.slice(0, 8)}`;

  const result = await db.runTransaction(async transaction => {
    const snapshots = await transaction.getAll(requestRef, businessRef, userRef);
    const requestSnap = snapshots[0]!;
    const businessSnap = snapshots[1]!;
    const userSnap = snapshots[2]!;
    const previous = requestSnap.data();
    if (previous) {
      if (previous.configurationHash !== input.configurationHash || previous.ownerUid !== owner.uid)
        throw new Error("This onboarding request ID belongs to a different approved setup.");
      if (previous.status === "PENDING_REVIEW") return { ...previous.result as TradeBusinessResult, created: false };
      throw new Error("This onboarding request is already being provisioned; check its status before retrying.");
    }
    if (businessSnap.exists) throw new Error("The onboarding business record already exists without its request checkpoint.");
    if (userSnap.exists && userSnap.data()?.businessId && userSnap.data()?.businessId !== businessRef.id)
      throw new Error("This owner account is already linked to another Trade business.");
    const [slugMatches, ...abnMatches] = await Promise.all([
      transaction.get(db.collection("businesses").where("bookingSlug", "==", bookingSlug).limit(1)),
      ...(business.abn ? [transaction.get(db.collection("businesses").where("abn", "==", business.abn).limit(1))] : []),
    ]);
    if (!slugMatches.empty) throw new Error("Could not reserve a unique Trade booking link; retry after review.");
    if (abnMatches.some(snapshot => !snapshot.empty)) throw new Error("This ABN is already linked to a Trade business. Contact support to review the existing account.");

    const doc = {
      id: businessRef.id,
      businessName,
      businessType: trade.businessType,
      planId: selectedPlan.id,
      planName: selectedPlan.name,
      plan: {
        id: selectedPlan.id,
        name: selectedPlan.name,
        priceLabel: selectedPlan.priceLabel,
        ...(typeof selectedPlan.staff === "number" ? { staff: selectedPlan.staff } : {}),
        ...(typeof selectedPlan.trialDays === "number" ? { trialDays: selectedPlan.trialDays } : {}),
        ...(typeof selectedPlan.billingCycle === "string" ? { billingCycle: selectedPlan.billingCycle } : {}),
        ...(typeof selectedPlan.validityDays === "number" ? { validityDays: selectedPlan.validityDays } : {}),
      },
      billing_status: "pending",
      accountStatus: "pending_payment",
      ...(typeof selectedPlan.staff === "number" ? { staffLimit: selectedPlan.staff } : {}),
      abn: business.abn ?? null,
      businessStructure: trade.businessStructure,
      registeredForGst: business.gstRegistered === true,
      gstPercentage: business.gstRegistered === true ? 10 : null,
      ...(business.address ? { businessAddress: business.address } : {}),
      state: trade.state,
      postcode: trade.postcode,
      timezone: business.timezone,
      businessPhone: business.ownerPhone,
      businessEmail: business.ownerEmail,
      mainSuburb: trade.serviceAreas![0],
      serviceAreas: trade.serviceAreas,
      bookingSlug,
      bookingPath: `/booknow/${bookingSlug}`,
      ownerUid: owner.uid,
      owner: { fullName: business.ownerName, email: business.ownerEmail },
      status: "pending_review",
      source: "command_centre_ai",
      isActive: false,
      ...(input.approval.method === "phone_confirmation" ? { dashboardAccessEnabled: true } : {}),
      onboardingProgress: 100,
      onboardingStep: "pending_subscription_and_launch_review",
      createdByUid: "command-centre-ai",
      createdByEmail: null,
      aiOnboardingRequestId: input.requestId,
      aiOnboardingConfigurationHash: input.configurationHash,
      aiOnboardingDetails: {
        businessHours: config.businessHours ?? [],
        services: config.services ?? [],
        staff: config.staff ?? [],
        ...(config.receptionistName ? { receptionistName: config.receptionistName } : {}),
        ...(config.did ? { requestedDid: config.did } : {}),
        ...(config.escalation ? { escalation: config.escalation } : {}),
        bookingPolicy: config.bookingPolicy ?? "staff_approval_required",
        ...(config.cancellationPolicy ? { cancellationPolicy: config.cancellationPolicy } : {}),
        terms: config.terms,
        approval: input.approval,
      },
      workingHours: Object.fromEntries(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day => [day, { closed: true }])),
      enabledModules: { requests: true, quotations: true, invoices: true, jobs: true },
      createdAt: now,
      updatedAt: now,
    };
    const created: TradeBusinessResult = { status: "PENDING_REVIEW", ownerUid: owner.uid, businessId: businessRef.id, created: true };
    transaction.create(businessRef, doc);
    transaction.set(userRef, {
      uid: owner.uid,
      email: owner.email ?? business.ownerEmail,
      fullName: business.ownerName,
      businessId: businessRef.id,
      role: "owner",
      aiOnboardingRequestId: input.requestId,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.create(requestRef, {
      ownerUid: owner.uid,
      businessId: businessRef.id,
      configurationHash: input.configurationHash,
      approval: input.approval,
      status: "PENDING_REVIEW",
      result: created,
      createdAt: now,
      updatedAt: now,
    });
    return created;
  });

  await auth.setCustomUserClaims(owner.uid, { ...(owner.customClaims ?? {}), role: "owner", businessId: businessRef.id });
  return result;
}

export function tradeOwnerReviewUrl(draftId: string): string {
  const base = (process.env.TRADE_ADMIN_BASE_URL?.trim() || "https://trade.bmspros.com.au").replace(/\/+$/, "");
  return `${base}/ai-onboarding/${encodeURIComponent(draftId)}`;
}
