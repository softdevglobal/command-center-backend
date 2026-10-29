import { createHash } from "node:crypto";
import admin from "firebase-admin";
import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import { getDidMappingByDid, listDidMappings } from "../did-mappings.service.js";
import { AiAgentSetupError, type ProvisioningDependencies } from "../ai/ai-agent-provisioning.shared.js";
import type { DidMappingRow } from "../../types/did-mapping.types.js";
import { resolveVoiceProductForDid } from "../ai/voice-route.service.js";

export { AiAgentSetupError } from "../ai/ai-agent-provisioning.shared.js";
export type BlackAiAgentProvisioningInput = {
  did: string;
  name: string;
  createdBy: string;
  expectedAssignment?: { tenantId: string; ownerUid: string; branchId: string; queueId: string };
};
export function aiAgentUid(did: string): string {
  return `ai-black-${createHash("sha256").update(did).digest("hex").slice(0, 40)}`;
}

export function createAiAgentProvisioner(deps: ProvisioningDependencies) {
  return async (input: BlackAiAgentProvisioningInput) => {
    const mapping = await deps.getMapping(input.did);
    if (!mapping?.tenant_id || !mapping.owner_id || !mapping.branch_id) {
      throw new AiAgentSetupError(400, "Select a phone number mapped to a workshop and branch first.");
    }
    const expected = input.expectedAssignment;
    if (expected && (mapping.tenant_id !== expected.tenantId || mapping.owner_id !== expected.ownerUid ||
        mapping.branch_id !== expected.branchId || mapping.queue_id !== expected.queueId)) {
      throw new AiAgentSetupError(409, "The phone assignment changed after owner approval. Review the setup again.");
    }
    const uid = aiAgentUid(mapping.did);
    const existing = await deps.getAgent(uid);
    if (existing) {
      if (
        existing.accountType !== "ai-front-office" || existing.brand !== "black" ||
        existing.did !== mapping.did || existing.ownerUid !== mapping.owner_id ||
        existing.branchId !== mapping.branch_id || existing.role !== "agent" ||
        existing.suspended === true || !Array.isArray(existing.assignedWorkshops) ||
        existing.assignedWorkshops.length !== 1 || existing.assignedWorkshops[0] !== mapping.owner_id
      ) {
        throw new AiAgentSetupError(409, "This phone number has an inactive or differently assigned AI account. Review it before creating another.");
      }
      const user = await deps.getUser(uid);
      if (user.disabled) throw new AiAgentSetupError(409, "This AI account is disabled. Review it before continuing.");
      return { firebaseBlackUid: uid, did: mapping.did, name: String(existing.displayName ?? input.name), created: false };
    }

    // A stable UID makes retries reuse one account per DID. Never adopt an
    // unrelated existing Firebase account or change a human account's role.
    try {
      await deps.createUser({ uid, displayName: input.name });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "auth/uid-already-exists") {
        throw new AiAgentSetupError(409, "Account creation is already in progress or incomplete. Retry shortly; contact your administrator if it persists.");
      }
      throw error;
    }
    try {
      await deps.markUser(uid);
      await deps.createAgent(uid, {
        displayName: input.name, name: input.name, role: "agent",
        assignedWorkshops: [mapping.owner_id], suspended: false,
        agentType: "workshop", accountType: "ai-front-office", brand: "black",
        did: mapping.did, tenantId: mapping.tenant_id, ownerUid: mapping.owner_id,
        branchId: mapping.branch_id, workshopName: mapping.workshop_name,
        branchName: mapping.branch_name, createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      try { await deps.deleteUser(uid); }
      catch { console.error("[ai accounts] Could not remove partial Firebase account", uid); }
      throw error;
    }
    return { firebaseBlackUid: uid, did: mapping.did, name: input.name, created: true };
  };
}

function blackApp(): admin.app.App {
  const app = getFirebaseBlackApp();
  if (!app) throw new AiAgentSetupError(503, "Firebase Black is not configured on the backend.");
  return app;
}

async function isBlackMapping(mapping: DidMappingRow): Promise<boolean> {
  if (!mapping.tenant_id || !mapping.owner_id || !mapping.branch_id?.trim()) return false;
  try {
    const route = await resolveVoiceProductForDid(mapping.did.replace(/^\+/, ""));
    return route.brand === "black";
  } catch {
    return false;
  }
}

const pending = new Map<string, Promise<Awaited<ReturnType<ReturnType<typeof createAiAgentProvisioner>>>>>();

export async function provisionBlackAiAgent(input: BlackAiAgentProvisioningInput) {
  const pendingKey = JSON.stringify([input.did, input.expectedAssignment ?? null]);
  const current = pending.get(pendingKey);
  if (current) return current;
  const app = blackApp();
  const auth = admin.auth(app);
  const db = admin.firestore(app);
  const provision = createAiAgentProvisioner({
    getMapping: async (did) => {
      const mapping = await getDidMappingByDid(did);
      if (mapping && !await isBlackMapping(mapping)) {
        throw new AiAgentSetupError(400, "Choose a DID mapped to a Black workshop, branch and queue.");
      }
      return mapping;
    },
    getAgent: async (uid) => (await db.doc(`call_center_agents/${uid}`).get()).data(),
    getUser: (uid) => auth.getUser(uid),
    createUser: (user) => auth.createUser(user),
    markUser: (uid) => auth.setCustomUserClaims(uid, { aiFrontOffice: true, brand: "black" }),
    createAgent: async (uid, data) => { await db.doc(`call_center_agents/${uid}`).create(data); },
    deleteUser: (uid) => auth.deleteUser(uid),
  });
  const task = provision(input).finally(() => pending.delete(pendingKey));
  pending.set(pendingKey, task);
  return task;
}

export async function listBlackAiAgentOptions() {
  const db = admin.firestore(blackApp());
  const [mappings, documents] = await Promise.all([
    listDidMappings({}),
    db.collection("call_center_agents").where("accountType", "==", "ai-front-office").get(),
  ]);
  const accounts = new Map(documents.docs.map((doc) => [doc.id, doc.data()]));
  const scopedMappings = (await Promise.all(mappings.map(async (row) => await isBlackMapping(row) ? row : null)))
    .filter((row): row is DidMappingRow => row !== null);
  return scopedMappings.map((row) => {
    const uid = aiAgentUid(row.did);
    const account = accounts.get(uid);
    return {
      did: row.did, workshopName: row.workshop_name || "Workshop", branchName: row.branch_name || "Branch",
      account: account ? { firebaseBlackUid: uid, name: String(account.displayName ?? "AI Receptionist") } : null,
    };
  });
}
