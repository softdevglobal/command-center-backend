import { timingSafeEqual } from "node:crypto";
import admin from "firebase-admin";

import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";
import {
  proxyPinkCallCenterBookingAvailability,
  proxyPinkCallCenterCreateBooking,
} from "./pink-call-center-bookings.proxy.service.js";
import {
  proxyPinkCallCenterBranchById,
  proxyPinkCallCenterServices,
} from "./pink-call-center-catalog.proxy.service.js";
import { getDidMappingByDid } from "../did-mappings.service.js";
import { resolveVoiceProductForDid } from "../ai/voice-route.service.js";
import { pinkAiAgentUid } from "./pink-ai-agent-provisioning.service.js";
import { createPinkBookingTools, type PinkSlotOffer, type PinkSubmissionRecord } from "./pink-booking.service.js";
import { sendPinkAiBookingNotifications } from "./pink-booking-notifications.service.js";
export { pinkAvailabilityArguments, pinkBookingArguments } from "./pink-booking.service.js";

export type PinkMcpTenant = { did: string; token: string; ownerUid: string; branchId: string; pinkAgentUid: string };
export class PinkAgentIdentityError extends Error { readonly code = "PINK_AGENT_SETUP_REQUIRED"; }

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authenticatePinkMcp(bearer: string, did: string): Promise<PinkMcpTenant | undefined> {
  if (!bearer || bearer.length > 4096 || !/^\d{6,15}$/.test(did)) return undefined;
  const bridgeSecret = process.env.AI_VOICE_BRIDGE_SECRET?.trim() ?? "";
  if (bridgeSecret.length < 32 || !safeEqual(bridgeSecret, bearer)) return undefined;
  try {
    const route = await resolveVoiceProductForDid(did);
    if (route.brand !== "pink") return undefined;
    const matches = (await Promise.all([getDidMappingByDid(did), getDidMappingByDid(`+${did}`)])).filter(Boolean);
    if (matches.length !== 1) return undefined;
    const mapping = matches[0]!;
    if (!mapping.owner_id || !mapping.branch_id?.trim()) return undefined;
    return { did: mapping.did, token: bearer, ownerUid: mapping.owner_id, branchId: mapping.branch_id, pinkAgentUid: pinkAiAgentUid(mapping.did) };
  } catch {
    return undefined;
  }
}

/** Bind credentials to the current Pink DID mapping; mapping edits take effect immediately. */
export async function bindPinkMcpTenantToMapping(tenant: PinkMcpTenant): Promise<PinkMcpTenant> {
  const digits = tenant.did.replace(/^\+/, "");
  const matches = (await Promise.all([getDidMappingByDid(digits), getDidMappingByDid(`+${digits}`)])).filter(Boolean);
  if (matches.length !== 1) throw new Error("Pink DID mapping is missing or ambiguous.");
  const mapping = matches[0]!;
  const route = await resolveVoiceProductForDid(digits, async did => did === mapping.did ? mapping : null);
  if (route.brand !== "pink" || !mapping.owner_id || !mapping.branch_id?.trim()) throw new Error("DID is not mapped to a Pink salon and branch.");
  if ((tenant.ownerUid && tenant.ownerUid !== mapping.owner_id) || (tenant.branchId && tenant.branchId !== mapping.branch_id)) {
    throw new Error("Pink MCP credential is pinned to a previous salon assignment.");
  }
  return { ...tenant, ownerUid: mapping.owner_id, branchId: mapping.branch_id };
}

async function pinkApp(): Promise<admin.app.App> {
  const app = getFirebasePinkApp();
  if (!app) throw new PinkAgentIdentityError("Firebase Pink is not configured.");
  return app;
}

/** Verify a dedicated AI identity and mint a short-lived Pink Firebase token. */
async function pinkAgentToken(tenant: PinkMcpTenant): Promise<string> {
  const app = await pinkApp();
  const [user, snap] = await Promise.all([
    admin.auth(app).getUser(tenant.pinkAgentUid),
    admin.firestore(app).doc(`call_center_agents/${tenant.pinkAgentUid}`).get(),
  ]);
  const agent = snap.data();
  const assigned = Array.isArray(agent?.assignedWorkshops) ? agent.assignedWorkshops.filter((v): v is string => typeof v === "string") : [];
  if (user.disabled || user.customClaims?.aiFrontOffice !== true || user.customClaims?.brand !== "pink" ||
      !snap.exists || agent?.accountType !== "ai-front-office" || agent?.brand !== "pink" || agent?.role !== "agent" || agent?.did !== tenant.did ||
      agent?.ownerUid !== tenant.ownerUid || agent?.branchId !== tenant.branchId || agent?.suspended === true ||
      assigned.length !== 1 || assigned[0] !== tenant.ownerUid) {
    throw new PinkAgentIdentityError("Create an active Pink AI receptionist assigned to this salon, branch and DID.");
  }
  const customToken = await admin.auth(app).createCustomToken(tenant.pinkAgentUid);
  const apiKey = process.env.FIREBASE_PINK_WEB_API_KEY?.trim();
  if (!apiKey) throw new PinkAgentIdentityError("Firebase Pink sign-in is not configured.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null) as { idToken?: unknown } | null;
  if (!response.ok || typeof body?.idToken !== "string" || !body.idToken) throw new PinkAgentIdentityError("Pink AI receptionist sign-in failed.");
  return body.idToken;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
async function readJson(response: Response, label: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  const body = record(await response.json().catch(() => null));
  if (!Object.keys(body).length) throw new Error(`${label} returned an invalid response.`);
  return body;
}

export async function resolvePinkBranch(tenant: PinkMcpTenant) {
  const token = await pinkAgentToken(tenant);
  const body = await readJson(await proxyPinkCallCenterBranchById(token, tenant.ownerUid, tenant.branchId, {}), "Pink branch lookup");
  const branch = record(body.branch ?? body);
  if (String(branch.id ?? branch.branchId ?? "") !== tenant.branchId) throw new Error("Pink returned a different branch than the assigned branch.");
  return { id: tenant.branchId, name: branch.name, address: branch.address, phone: branch.phone,
    timezone: branch.timezone ?? branch.timeZone, hours: branch.hours ?? branch.openingHours };
}

export async function getPinkBusinessProfile(tenant: PinkMcpTenant) {
  const branch = await resolvePinkBranch(tenant);
  const mapping = await getDidMappingByDid(tenant.did);
  return { brand: "pink", did: tenant.did, ownerUid: tenant.ownerUid, branch: { ...branch, salonName: mapping?.workshop_name },
    bookingWorkflow: "STAFF_REVIEW", message: "New bookings are requests until Pink reports a confirmed status." };
}

export async function listPinkServices(tenant: PinkMcpTenant) {
  const token = await pinkAgentToken(tenant);
  const body = await readJson(await proxyPinkCallCenterServices(token, tenant.ownerUid, { branchId: tenant.branchId }), "Pink service lookup");
  const rows = Array.isArray(body.services) ? body.services : Array.isArray(body.data) ? body.data : [];
  return rows.filter(value => {
    const row = record(value);
    return row.active !== false && row.isActive !== false && row.status !== "inactive";
  }).map(value => {
    const row = record(value);
    return { id: row.id, name: row.name, description: row.description, price: row.price, duration: row.duration };
  }).filter(row => typeof row.id === "string" && typeof row.name === "string");
}

/** Durable Firestore storage and Pink authentication for the testable booking flow. */
async function bookingToolsForTenant(tenant: PinkMcpTenant) {
  const app = await pinkApp(), db = admin.firestore(app);
  const submissions = db.collection("ai_pink_submissions");
  return createPinkBookingTools({
    scope: () => bindPinkMcpTenantToMapping(tenant),
    branch: resolvePinkBranch,
    services: listPinkServices,
    availability: async (scope, date, serviceIds) => readJson(await proxyPinkCallCenterBookingAvailability(
      await pinkAgentToken(scope), scope.ownerUid, { branchId: scope.branchId, date, serviceIds: serviceIds.join(",") }), "Pink availability"),
    saveOffer: async (token, offer) => { await db.collection("ai_pink_slot_offers").doc(token).create(offer); },
    readOffer: async token => (await db.collection("ai_pink_slot_offers").doc(token).get()).data() as PinkSlotOffer | undefined,
    readSubmission: async key => (await submissions.doc(key).get()).data() as PinkSubmissionRecord | undefined,
    claim: (key, fingerprint) => db.runTransaction(async transaction => {
      const ref = submissions.doc(key), snap = await transaction.get(ref);
      if (snap.exists) return snap.data() as PinkSubmissionRecord;
      transaction.create(ref, { fingerprint, state: "processing", createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return undefined;
    }),
    complete: async (key, result) => { await submissions.doc(key).update({ result, state: "complete", updatedAt: admin.firestore.FieldValue.serverTimestamp() }); },
    submit: async (scope, payload, requestKey) => {
      const response = await proxyPinkCallCenterCreateBooking(await pinkAgentToken(scope), scope.ownerUid, payload, requestKey);
      return { ok: response.ok, status: response.status, body: record(await response.json().catch(() => null)) };
    },
    notify: sendPinkAiBookingNotifications,
    enabled: () => process.env.AI_MCP_PINK_BOOKINGS_ENABLED === "true",
  });
}

export async function getPinkAvailability(tenant: PinkMcpTenant, raw: unknown) {
  return (await bookingToolsForTenant(tenant)).getAvailableSlots(raw);
}

export async function createPinkBooking(tenant: PinkMcpTenant, raw: unknown) {
  return (await bookingToolsForTenant(tenant)).createBooking(raw);
}
