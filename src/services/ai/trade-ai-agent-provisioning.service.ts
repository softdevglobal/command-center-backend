import { createHash } from "node:crypto";
import admin from "firebase-admin";
import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import { getDidMappingByDid, listDidMappings } from "../did-mappings.service.js";
import { resolveVoiceProductForDid } from "./voice-route.service.js";
import { AiAgentSetupError, type ProvisioningDependencies } from "./black-ai-agent-provisioning.service.js";

export function tradeAiAgentUid(did: string): string {
  return `ai-trade-${createHash("sha256").update(did.replace(/^\+/, "")).digest("hex").slice(0, 40)}`;
}

export function activeTradeAgent(data: Record<string, unknown> | undefined, did: string, businessId: string): boolean {
  return !!data && data.accountType === "ai-front-office" && data.brand === "trade" &&
    data.role === "ai_receptionist" && data.did === did && data.businessId === businessId &&
    data.isActive === true && data.suspended !== true && !["suspended", "inactive", "disabled"].includes(String(data.status)) &&
    Array.isArray(data.assignedBusinessIds) && data.assignedBusinessIds.length === 1 && data.assignedBusinessIds[0] === businessId;
}

/** Never adopt a human identity or silently reassign an existing AI account. */
export function createTradeAiAgentProvisioner(deps: ProvisioningDependencies) {
  return async (input: { did: string; name: string; createdBy: string }) => {
    const mapping = await deps.getMapping(input.did);
    if (!mapping?.tenant_id || !mapping.owner_id || mapping.branch_id?.trim()) {
      throw new AiAgentSetupError(400, "Choose a DID mapped to a Trade business and Blue queue, without a Black branch.");
    }
    const uid = tradeAiAgentUid(mapping.did);
    const existing = await deps.getAgent(uid);
    if (existing) {
      if (!activeTradeAgent(existing, mapping.did, mapping.owner_id) || (await deps.getUser(uid)).disabled) {
        throw new AiAgentSetupError(409, "This Trade AI account is inactive or assigned differently. Review its assignment.");
      }
      return { brand: "trade" as const, firebaseBlueUid: uid, did: mapping.did, name: String(existing.displayName ?? input.name), created: false };
    }
    try { await deps.createUser({ uid, displayName: input.name }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "auth/uid-already-exists") {
        throw new AiAgentSetupError(409, "This AI identity already exists without a matching assignment. Contact your administrator.");
      }
      throw error;
    }
    try {
      await deps.markUser(uid);
      await deps.createAgent(uid, { displayName: input.name, name: input.name, role: "ai_receptionist",
        accountType: "ai-front-office", brand: "trade", did: mapping.did, tenantId: mapping.tenant_id,
        businessId: mapping.owner_id, assignedBusinessIds: [mapping.owner_id], workshopOwnerUid: mapping.owner_id,
        workshopName: mapping.workshop_name, isActive: true, suspended: false, status: "active",
        agentType: "workshop", createdBy: input.createdBy, createdAt: new Date().toISOString() });
    } catch (error) {
      await deps.deleteUser(uid).catch(() => console.error("[trade AI] Could not remove partial identity", uid));
      throw error;
    }
    return { brand: "trade" as const, firebaseBlueUid: uid, did: mapping.did, name: input.name, created: true };
  };
}

export async function mappedTradeBusiness(did: string) {
  const digits = did.replace(/^\+/, "");
  if (!/^\d{6,15}$/.test(digits)) throw new AiAgentSetupError(400, "Invalid Trade DID.");
  const matches = (await Promise.all([getDidMappingByDid(digits), getDidMappingByDid(`+${digits}`)])).filter(row => row !== null);
  if (matches.length !== 1) throw new AiAgentSetupError(409, "Trade DID mapping is missing or ambiguous.");
  const mapping = matches[0]!;
  // Resolve the product against this exact mapping snapshot, not a second read.
  const route = await resolveVoiceProductForDid(digits, async candidate => candidate === mapping.did ? mapping : null);
  if (route.brand !== "trade") throw new AiAgentSetupError(400, "This phone number is not mapped to Trade.");
  const businessId = mapping.owner_id;
  if (!businessId || !/^[^/]{1,128}$/.test(businessId) || [".", ".."].includes(businessId)) {
    throw new AiAgentSetupError(400, "The mapped Trade business ID is invalid.");
  }
  return mapping;
}

function blueApp() {
  const app = getFirebaseBlueApp();
  if (!app) throw new AiAgentSetupError(503, "Firebase Blue is not configured on the backend.");
  return app;
}

const pending = new Map<string, Promise<Awaited<ReturnType<ReturnType<typeof createTradeAiAgentProvisioner>>>>>();
export async function provisionTradeAiAgent(input: { did: string; name: string; createdBy: string }) {
  const key = input.did.replace(/^\+/, "");
  if (pending.has(key)) return pending.get(key)!;
  const app = blueApp(), auth = admin.auth(app), db = admin.firestore(app);
  const provision = createTradeAiAgentProvisioner({ getMapping: async did => {
    const mapping = await mappedTradeBusiness(did);
    const business = (await db.doc(`businesses/${mapping.owner_id}`).get()).data();
    if (!business || business.isActive === false || business.status === "suspended") throw new AiAgentSetupError(400, "The mapped Trade business is unavailable.");
    return mapping;
  },
    getAgent: async uid => (await db.doc(`call_center_agents/${uid}`).get()).data(),
    getUser: uid => auth.getUser(uid), createUser: user => auth.createUser(user),
    markUser: uid => auth.setCustomUserClaims(uid, { role: "ai_receptionist", aiFrontOffice: true, brand: "trade" }),
    createAgent: async (uid, data) => { await db.doc(`call_center_agents/${uid}`).create(data); },
    deleteUser: uid => auth.deleteUser(uid) });
  const task = provision(input).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export async function listTradeAiAgentOptions() {
  const db = admin.firestore(blueApp());
  const mappings = await listDidMappings({});
  const options = [];
  for (const row of mappings.filter(row => row.tenant_id && row.owner_id && !row.branch_id?.trim())) {
    try { await mappedTradeBusiness(row.did); } catch { continue; }
    const uid = tradeAiAgentUid(row.did);
    const account = (await db.doc(`call_center_agents/${uid}`).get()).data();
    options.push({ brand: "trade" as const, did: row.did, workshopName: row.workshop_name || "Trade business", branchName: "",
      account: account ? { firebaseBlueUid: uid, name: String(account.displayName ?? "AI Receptionist") } : null });
  }
  return options;
}
