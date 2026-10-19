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
  if (owner.disabled || !owner.emailVerified || owner.email?.toLowerCase() !== config.business.ownerEmail?.toLowerCase())
    fail("The approved Trade owner must verify their email before provisioning.");

  const requestRef = db.doc(`ai_onboarding_requests/${input.requestId}`);
  const businessRef = db.collection("businesses").doc(`ai-${input.requestId.replace(/-/g, "").slice(0, 20)}`);
  const userRef = db.collection("users").doc(owner.uid);
  const business = config.business;
  const trade = config.tradeBusiness;
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
      abn: business.abn ?? null,
      businessStructure: trade.businessStructure,
      registeredForGst: business.gstRegistered === true,
      gstPercentage: business.gstRegistered === true ? 10 : null,
      businessAddress: business.address,
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
        receptionistName: config.receptionistName,
        requestedDid: config.did,
        escalation: config.escalation,
        bookingPolicy: config.bookingPolicy,
        cancellationPolicy: config.cancellationPolicy,
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
