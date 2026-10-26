import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDidMappingByDid } from "../did-mappings.service.js";
import type { DidMappingRow } from "../../types/did-mapping.types.js";
import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import { resolveVoiceProductForDid } from "./voice-route.service.js";

const documentId = z.string().trim().min(1).max(128).refine(value => !value.includes("/") && value !== "." && value !== "..");
const tenantSchema = z.object({ did: z.string().trim().regex(/^\+?\d{6,15}$/), token: z.string().trim().min(32) }).strict();
export type TradeMcpTenant = z.infer<typeof tenantSchema> & { pinnedBusinessId?: string };
export type TradeBusinessScope = Pick<TradeMcpTenant, "did" | "pinnedBusinessId">;

export function parseTradeMcpTenants(raw = process.env.AI_MCP_TRADE_TENANT_CONFIG_JSON ?? "[]"): TradeMcpTenant[] {
  const tenants = z.array(tenantSchema).parse(JSON.parse(raw));
  if (new Set(tenants.map(t => t.did.replace(/^\+/, ""))).size !== tenants.length || new Set(tenants.map(t => t.token)).size !== tenants.length) {
    throw new Error("Trade MCP DIDs and tokens must be unique.");
  }
  const reserved = [process.env.AI_VOICE_BRIDGE_SECRET];
  const black: unknown = JSON.parse(process.env.AI_MCP_TENANT_CONFIG_JSON || "[]");
  if (!Array.isArray(black)) throw new Error("Invalid Black MCP configuration.");
  for (const entry of black) if (entry && typeof entry === "object") reserved.push(entry.token);
  if (tenants.some(t => reserved.includes(t.token))) throw new Error("Trade MCP credentials must be separate from Black and bridge credentials.");
  return tenants;
}

export function authenticateTradeMcp(bearer: string, tenants: TradeMcpTenant[]): TradeMcpTenant | undefined {
  if (!bearer || bearer.length > 4096) return undefined;
  return tenants.find(t => {
    const expected = Buffer.from(t.token), supplied = Buffer.from(bearer);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  });
}

type MappingLookup = (did: string) => Promise<DidMappingRow | null>;
type QueueLookup = (queueId: string, tenantId: string) => Promise<{ id: string; name: string | null; type: string | null; tenant_id: string } | null>;

export async function resolveTradeDidMapping(did: string, lookup: MappingLookup = getDidMappingByDid, pinnedBusinessId?: string, queueLookup?: QueueLookup) {
  if (!/^\+?\d{6,15}$/.test(did)) throw new Error("Invalid Trade DID.");
  const digits = did.replace(/^\+/, "");
  const product = await resolveVoiceProductForDid(digits, lookup, queueLookup);
  if (product.brand !== "trade") throw new Error("DID is not assigned to the Trade product.");
  const matches = (await Promise.all([lookup(digits), lookup(`+${digits}`)])).filter((mapping): mapping is DidMappingRow => mapping !== null);
  if (matches.length !== 1) throw new Error("Trade DID mapping is missing or ambiguous.");
  const mapping = matches[0]!;
  // The existing dashboard writes Blue business IDs into owner_id, with no branch.
  // Reject Black workshop mappings rather than interpreting a Black owner as a Trade business.
  if (!mapping.tenant_id || !mapping.owner_id || mapping.branch_id?.trim()) throw new Error("DID is not mapped to a Trade business.");
  if (pinnedBusinessId !== undefined && mapping.owner_id !== pinnedBusinessId) throw new Error("The Trade business assignment changed during this call.");
  return { did: mapping.did, tenantId: mapping.tenant_id, businessId: documentId.parse(mapping.owner_id), businessName: mapping.workshop_name };
}

export async function authenticateTradeMcpRequest(bearer: string, suppliedDid: string, lookup: MappingLookup = getDidMappingByDid, queueLookup?: QueueLookup): Promise<TradeMcpTenant | undefined> {
  if (!bearer || bearer.length > 4096) return undefined;
  const tenants = parseTradeMcpTenants();
  const bridgeSecret = process.env.AI_VOICE_BRIDGE_SECRET?.trim();
  if (bridgeSecret && bridgeSecret.length >= 32 && authenticateTradeMcp(bearer, [{ did: "", token: bridgeSecret }])) {
    // Match Black's bridge contract: digits only; optional + is handled by mapping lookup.
    if (!/^\d{6,15}$/.test(suppliedDid)) return undefined;
    try {
      const mapping = await resolveTradeDidMapping(suppliedDid, lookup, undefined, queueLookup);
      return { did: mapping.did, token: bearer };
    } catch { return undefined; }
  }
  return authenticateTradeMcp(bearer, tenants);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date.");
const text = z.string().trim().min(1).max(200);
export const tradeAvailabilityArguments = z.object({ from: date, to: date }).strict();
export const tradeRequestArguments = z.object({
  requestKey: z.string().trim().min(16).max(128),
  customerConfirmed: z.literal(true),
  serviceId: documentId,
  customer: z.object({ fullName: text, email: z.string().trim().email().max(254), phone: z.string().trim().min(6).max(40) }).strict(),
  address: z.object({ street: z.string().trim().max(300), suburb: text, state: text, postcode: z.string().regex(/^\d{4}$/) }).strict(),
  preferredSlots: z.array(z.object({ date, timeRange: z.enum(["morning", "afternoon"]) }).strict()).min(1).max(3),
  budgetAud: z.number().finite().nonnegative().nullable().default(null),
  customerNotes: z.string().trim().max(2000).default(""),
}).strict();

function database() {
  const app = getFirebaseBlueApp();
  if (!app) throw new Error("Firebase Blue is not configured.");
  return app.firestore();
}

async function resolveTradeBusinessRecord(tenant: TradeBusinessScope) {
  const mapping = await resolveTradeDidMapping(tenant.did, undefined, tenant.pinnedBusinessId);
  const snap = await database().collection("businesses").doc(mapping.businessId).get();
  const data = snap.data();
  if (!data || data.isActive === false || data.status === "suspended") throw new Error("Trade business is unavailable.");
  return { data, businessId: mapping.businessId, mapping };
}

export async function resolveTradeBusiness(tenant: TradeBusinessScope) {
  const business = await resolveTradeBusinessRecord(tenant);
  const { data, businessId } = business;
  if (typeof data.bookingSlug !== "string" || !data.bookingSlug.trim()) throw new Error("Trade business has no booking link.");
  // The public booking API resolves by slug: reject ambiguous or stale slug mappings.
  const matches = await database().collection("businesses").where("bookingSlug", "==", data.bookingSlug).limit(2).get();
  if (matches.size !== 1 || matches.docs[0]?.id !== businessId) throw new Error("Trade booking link is ambiguous.");
  return business;
}

function apiUrl(path: string) {
  const base = new URL(process.env.TRADE_API_BASE_URL ?? "");
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) throw new Error("Trade API requires HTTPS.");
  return new URL(path, base);
}

export async function listTradeServices(tenant: TradeBusinessScope) {
  const business = await resolveTradeBusinessRecord(tenant);
  const snap = await database().collection("services").where("businessId", "==", business.businessId).get();
  return snap.docs.filter(doc => doc.data().isActive === true).map(doc => {
    const data = doc.data();
    return { id: doc.id, name: data.name, businessType: data.businessType, defaultDurationMin: data.defaultDurationMin };
  });
}

export async function getTradeBusinessProfile(tenant: TradeBusinessScope) {
  const { data, businessId, mapping } = await resolveTradeBusinessRecord(tenant);
  return { brand: "trade", did: mapping.did, businessId, businessName: data.businessName, address: data.businessAddress, phone: data.businessPhone, email: data.businessEmail, timezone: data.timezone || "Australia/Melbourne", bookingWorkflow: "STAFF_REVIEW" };
}

export async function getTradeAvailability(tenant: TradeMcpTenant, raw: unknown) {
  const args = tradeAvailabilityArguments.parse(raw);
  const days = (Date.parse(args.to) - Date.parse(args.from)) / 86400000;
  if (days < 0 || days >= 90) throw new Error("Choose a date range of 1 to 90 days.");
  const business = await resolveTradeBusiness(tenant);
  const url = apiUrl("/api/booking/slot-availability");
  url.search = new URLSearchParams({ slug: business.data.bookingSlug, from: args.from, to: args.to }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: "error" });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || body.ok !== true || !Array.isArray(body.unavailable)) throw new Error("Trade availability could not be verified.");
  const unavailable = body.unavailable.map(slot => z.object({ date, timeRange: z.enum(["morning", "afternoon"]) }).parse(slot));
  return { brand: "trade", timezone: business.data.timezone || "Australia/Melbourne", from: args.from, to: args.to, unavailable, sessions: ["morning", "afternoon"], message: "These sessions are unavailable. Other sessions are preferences subject to validation and staff review, not confirmed appointments." };
}

export type TradeSubmissionResult = { status: "PENDING_REVIEW" | "UNKNOWN" | "REJECTED"; requestId?: string; message: string };
export interface TradeSubmissionStore {
  claim(key: string, fingerprint: string): Promise<{ fingerprint: string; result?: TradeSubmissionResult } | null>;
  complete(key: string, result: TradeSubmissionResult): Promise<void>;
}

const unknownResult: TradeSubmissionResult = { status: "UNKNOWN", message: "Staff must verify this request. Do not resubmit with another key or claim it was saved." };

/** Claim durably BEFORE contacting Trade. An uncertain upstream result is never resubmitted. */
export async function submitTradeOnce(store: TradeSubmissionStore, scope: string, requestKey: string, payload: unknown, send: () => Promise<TradeSubmissionResult>): Promise<TradeSubmissionResult> {
  const key = createHash("sha256").update(JSON.stringify([scope, requestKey])).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const existing = await store.claim(key, fingerprint);
  if (existing) return existing.fingerprint === fingerprint ? existing.result ?? unknownResult : { status: "REJECTED", message: "This request key was already used with different details. Ask staff to verify the original request." };
  let result: TradeSubmissionResult;
  try { result = await send(); } catch { result = unknownResult; }
  await store.complete(key, result);
  return result;
}

function submissionStore(): TradeSubmissionStore {
  const collection = database().collection("ai_trade_submissions");
  return {
    claim: (key, fingerprint) => database().runTransaction(async transaction => {
      const ref = collection.doc(key), snap = await transaction.get(ref);
      if (snap.exists) return snap.data() as { fingerprint: string; result?: TradeSubmissionResult };
      transaction.create(ref, { fingerprint, createdAt: new Date() });
      return null;
    }),
    complete: async (key, result) => { await collection.doc(key).update({ result, updatedAt: new Date() }); },
  };
}

export async function createTradeInspectionRequest(tenant: TradeMcpTenant, raw: unknown) {
  if (process.env.AI_MCP_TRADE_REQUESTS_ENABLED !== "true") throw new Error("Trade request creation is disabled.");
  const { requestKey, customerConfirmed: _, ...details } = tradeRequestArguments.parse(raw);
  const business = await resolveTradeBusiness(tenant);
  const service = await database().collection("services").doc(details.serviceId).get();
  if (!service.exists || service.data()?.businessId !== business.businessId || service.data()?.isActive !== true) throw new Error("Choose an active service from this business.");
  const payload = { ...details, slug: business.data.bookingSlug, requestType: "existing_service" };
  const url = apiUrl("/api/booking/inspection-request");
  return submitTradeOnce(submissionStore(), business.businessId, requestKey, payload, async () => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000), redirect: "error" });
    const body = await response.json() as Record<string, unknown>;
    if (response.ok && body.ok === true && typeof body.requestId === "string" && body.requestId) return { status: "PENDING_REVIEW", requestId: body.requestId, message: "Inspection request submitted for staff review. This is not a confirmed appointment." };
    // Upstream notifications/audit may fail after a successful write. Never retry automatically.
    return unknownResult;
  });
}
