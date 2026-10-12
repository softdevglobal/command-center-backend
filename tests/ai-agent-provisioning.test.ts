import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import aiAgentAdminRoutes from "../src/routes/ai/ai-agent-admin.routes.js";
import { AiAgentSetupError, aiAgentUid, createAiAgentProvisioner, type ProvisioningDependencies } from "../src/services/ai/black-ai-agent-provisioning.service.js";

function fixture() {
  const mapping = { did: "+61400000000", tenant_id: "tenant-a", queue_id: "queue-a", label: "Pilot", owner_id: "owner-a", branch_id: "branch-a", workshop_name: "Workshop A", branch_name: "Branch A" };
  let document: Record<string, unknown> | undefined;
  let disabled = false;
  const writes: Array<{ uid: string; displayName: string }> = [];
  const deletions: string[] = [];
  const deps: ProvisioningDependencies = {
    getMapping: async () => mapping,
    getAgent: async () => document,
    getUser: async (uid) => ({ uid, disabled }),
    createUser: async (input) => { writes.push(input); return { uid: input.uid, disabled: false }; },
    markUser: async () => {},
    createAgent: async (_uid, data) => { document = data; },
    deleteUser: async (uid) => { deletions.push(uid); },
  };
  return { deps, mapping, writes, deletions, document: () => document, disable: () => { disabled = true; } };
}

const input = { did: "+61400000000", name: "Workshop AI", createdBy: "super-admin" };

test("creates one password-free identity scoped to the mapped workshop and reuses it on retry", async () => {
  const f = fixture();
  const provision = createAiAgentProvisioner(f.deps);
  const first = await provision(input);
  const second = await provision(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.firebaseBlackUid, second.firebaseBlackUid);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(f.writes[0]!).sort(), ["displayName", "uid"]);
  assert.deepEqual(f.document()?.assignedWorkshops, ["owner-a"]);
  assert.equal(f.document()?.role, "agent");
  assert.equal(f.document()?.branchId, "branch-a");
  assert.notEqual(aiAgentUid("+61400000001"), first.firebaseBlackUid);
});

test("rejects an unmapped DID without creating a Firebase account", async () => {
  const f = fixture();
  f.deps.getMapping = async () => null;
  await assert.rejects(createAiAgentProvisioner(f.deps)(input), (error) => error instanceof AiAgentSetupError && error.status === 400);
  assert.equal(f.writes.length, 0);
});

test("rejects a changed workshop mapping without reassigning an existing identity", async () => {
  const f = fixture();
  const provision = createAiAgentProvisioner(f.deps);
  await provision(input);
  f.mapping.owner_id = "owner-b";
  await assert.rejects(provision(input), (error) => error instanceof AiAgentSetupError && error.status === 409);
  assert.deepEqual(f.document()?.assignedWorkshops, ["owner-a"]);
  assert.equal(f.writes.length, 1);
});

test("rejects reuse of disabled and suspended identities", async () => {
  const f = fixture();
  const provision = createAiAgentProvisioner(f.deps);
  await provision(input);
  f.disable();
  await assert.rejects(provision(input), (error) => error instanceof AiAgentSetupError && error.status === 409);
  f.document()!.suspended = true;
  await assert.rejects(provision(input), (error) => error instanceof AiAgentSetupError && error.status === 409);
});

test("removes the new Firebase identity when its scoped document cannot be written", async () => {
  const f = fixture();
  f.deps.createAgent = async () => { throw new Error("simulated Firestore outage"); };
  await assert.rejects(createAiAgentProvisioner(f.deps)(input), /simulated Firestore outage/);
  assert.deepEqual(f.deletions, [aiAgentUid(input.did)]);
  assert.equal(f.document(), undefined);
});

test("does not adopt or modify an unrelated Firebase UID", async () => {
  const f = fixture();
  f.deps.createUser = async () => { throw Object.assign(new Error("UID exists"), { code: "auth/uid-already-exists" }); };
  await assert.rejects(createAiAgentProvisioner(f.deps)(input), (error) => error instanceof AiAgentSetupError && error.status === 409);
  assert.equal(f.document(), undefined);
  assert.equal(f.deletions.length, 0);
});

test("admin endpoints reject unauthenticated requests and setup-secret access before provisioning", async () => {
  const oldFlag = process.env.ALLOW_SETUP_SECRET_AUTH;
  const oldSecret = process.env.SETUP_SECRET_KEY;
  process.env.ALLOW_SETUP_SECRET_AUTH = "true";
  process.env.SETUP_SECRET_KEY = "test-only-setup-secret";
  const app = express();
  app.use(express.json());
  app.use("/ai-agents", aiAgentAdminRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/ai-agents`;
  try {
    for (const method of ["GET", "POST"]) {
      assert.equal((await fetch(url, { method })).status, 401);
      assert.equal((await fetch(url, { method, headers: { "x-setup-secret": "test-only-setup-secret" } })).status, 403);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (oldFlag === undefined) delete process.env.ALLOW_SETUP_SECRET_AUTH; else process.env.ALLOW_SETUP_SECRET_AUTH = oldFlag;
    if (oldSecret === undefined) delete process.env.SETUP_SECRET_KEY; else process.env.SETUP_SECRET_KEY = oldSecret;
  }
});
