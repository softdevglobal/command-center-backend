import { createHash } from "node:crypto";
import admin from "firebase-admin";
import { getFirebasePinkApp } from "../../db/firebase/firebase.pink.js";
import { getDidMappingByDid, listDidMappings } from "../did-mappings.service.js";
import { resolveVoiceProductForDid } from "../ai/voice-route.service.js";
import { AiAgentSetupError, type ProvisioningDependencies } from "../ai/ai-agent-provisioning.shared.js";

export function pinkAiAgentUid(did: string): string {
  return `ai-pink-${createHash("sha256").update(did.replace(/^\+/, "")).digest("hex").slice(0, 40)}`;
}

async function mappedPinkSalon(did: string) {
  const digits = did.replace(/^\+/, "");
  if (!/^\d{6,15}$/.test(digits)) throw new AiAgentSetupError(400, "Invalid Pink DID.");
  const matches = (await Promise.all([getDidMappingByDid(digits), getDidMappingByDid(`+${digits}`)])).filter(Boolean);
  if (matches.length !== 1) throw new AiAgentSetupError(409, "Pink DID mapping is missing or ambiguous.");
  const mapping = matches[0]!;
  const route = await resolveVoiceProductForDid(digits, async candidate => candidate === mapping.did ? mapping : null);
  if (route.brand !== "pink" || !mapping.owner_id || !mapping.branch_id?.trim()) {
    throw new AiAgentSetupError(400, "Choose a DID mapped to a Pink salon, branch and Pink queue.");
  }
  return mapping;
}

export function createPinkAiAgentProvisioner(deps: ProvisioningDependencies) {
  return async (input: { did: string; name: string; createdBy: string }) => {
    const mapping = await deps.getMapping(input.did);
    if (!mapping?.tenant_id || !mapping.owner_id || !mapping.branch_id?.trim()) {
      throw new AiAgentSetupError(400, "Choose a DID mapped to a Pink salon and branch first.");
    }
    const uid = pinkAiAgentUid(mapping.did);
    const existing = await deps.getAgent(uid);
    if (existing) {
      const assigned = Array.isArray(existing.assignedWorkshops) ? existing.assignedWorkshops : [];
      if (existing.accountType !== "ai-front-office" || existing.brand !== "pink" || existing.role !== "agent" ||
          existing.did !== mapping.did || existing.ownerUid !== mapping.owner_id || existing.branchId !== mapping.branch_id ||
          existing.suspended === true || assigned.length !== 1 || assigned[0] !== mapping.owner_id || (await deps.getUser(uid)).disabled) {
        throw new AiAgentSetupError(409, "This Pink AI account is inactive or assigned differently. Review its assignment.");
      }
      return { brand: "pink" as const, firebasePinkUid: uid, did: mapping.did, name: String(existing.displayName ?? input.name), created: false };
    }
    try { await deps.createUser({ uid, displayName: input.name }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "auth/uid-already-exists") {
        throw new AiAgentSetupError(409, "This Pink AI identity already exists without a matching assignment. Contact an administrator.");
      }
      throw error;
    }
    try {
      await deps.markUser(uid);
      await deps.createAgent(uid, { displayName: input.name, name: input.name, role: "agent", assignedWorkshops: [mapping.owner_id],
        suspended: false, agentType: "workshop", accountType: "ai-front-office", brand: "pink", did: mapping.did,
        tenantId: mapping.tenant_id, ownerUid: mapping.owner_id, branchId: mapping.branch_id,
        workshopName: mapping.workshop_name, branchName: mapping.branch_name, createdBy: input.createdBy,
        createdAt: new Date().toISOString() });
    } catch (error) {
      await deps.deleteUser(uid).catch(() => console.error("[pink AI] Could not remove partial identity", uid));
      throw error;
    }
    return { brand: "pink" as const, firebasePinkUid: uid, did: mapping.did, name: input.name, created: true };
  };
}

function pinkApp() {
  const app = getFirebasePinkApp();
  if (!app) throw new AiAgentSetupError(503, "Firebase Pink is not configured on the backend.");
  return app;
}

const pending = new Map<string, Promise<Awaited<ReturnType<ReturnType<typeof createPinkAiAgentProvisioner>>>>>();
export async function provisionPinkAiAgent(input: { did: string; name: string; createdBy: string }) {
  const key = input.did.replace(/^\+/, "");
  if (pending.has(key)) return pending.get(key)!;
  const app = pinkApp(), auth = admin.auth(app), db = admin.firestore(app);
  const provision = createPinkAiAgentProvisioner({ getMapping: async did => {
    const mapping = await mappedPinkSalon(did);
    const owner = (await db.doc(`users/${mapping.owner_id}`).get()).data();
    const branch = (await db.doc(`branches/${mapping.branch_id}`).get()).data();
    if (!owner || owner.role !== "salon_owner" || !branch || branch.ownerUid !== mapping.owner_id) {
      throw new AiAgentSetupError(400, "The mapped Pink salon or branch is unavailable.");
    }
    return mapping;
  }, getAgent: async uid => (await db.doc(`call_center_agents/${uid}`).get()).data(), getUser: uid => auth.getUser(uid),
    createUser: user => auth.createUser(user), markUser: uid => auth.setCustomUserClaims(uid, { aiFrontOffice: true, brand: "pink" }),
    createAgent: async (uid, data) => { await db.doc(`call_center_agents/${uid}`).create(data); }, deleteUser: uid => auth.deleteUser(uid) });
  const task = provision(input).finally(() => pending.delete(key)); pending.set(key, task); return task;
}

export async function listPinkAiAgentOptions() {
  const db = admin.firestore(pinkApp());
  const mappings = await listDidMappings({});
  const options = [];
  for (const row of mappings.filter(value => value.tenant_id && value.owner_id && value.branch_id?.trim())) {
    try { await mappedPinkSalon(row.did); } catch { continue; }
    const uid = pinkAiAgentUid(row.did), account = (await db.doc(`call_center_agents/${uid}`).get()).data();
    options.push({ brand: "pink" as const, did: row.did, workshopName: row.workshop_name || "Pink salon", branchName: row.branch_name || "Branch",
      account: account ? { firebasePinkUid: uid, name: String(account.displayName ?? "AI Receptionist") } : null });
  }
  return options;
}

export async function listPinkWorkshopOptions() {
  const db = admin.firestore(pinkApp());
  const owners = await db.collection("users").where("role", "==", "salon_owner").get();
  return Promise.all(owners.docs.map(async doc => {
    const data = doc.data();
    const branches = await db.collection("branches").where("ownerUid", "==", doc.id).get();
    return { ownerUid: doc.id, name: String(data.salonName ?? data.businessName ?? data.name ?? data.displayName ?? doc.id),
      branches: branches.docs.map(branch => ({ id: branch.id, name: String(branch.data().name ?? branch.data().branchName ?? branch.id) })) };
  }));
}
