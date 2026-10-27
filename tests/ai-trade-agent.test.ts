import assert from "node:assert/strict";
import test from "node:test";
import { activeTradeAgent, createTradeAiAgentProvisioner, tradeAiAgentUid } from "../src/services/ai/trade-ai-agent-provisioning.service.js";
import type { ProvisioningDependencies } from "../src/services/ai/black-ai-agent-provisioning.service.js";
import { createTradeAgentIdentity } from "../src/services/ai/trade-agent-identity.service.js";

function fixture() {
  const mapping = { did: "+61400000000", tenant_id: "tenant-a", owner_id: "business-a", queue_id: "blue", branch_id: "", label: "Trade", workshop_name: "Business A", branch_name: "" };
  let doc: Record<string, unknown> | undefined, disabled = false;
  const users: string[] = [], deleted: string[] = [];
  const deps: ProvisioningDependencies = {
    getMapping: async () => mapping, getAgent: async () => doc,
    getUser: async uid => ({ uid, disabled }),
    createUser: async input => { users.push(input.uid); return { uid: input.uid, disabled: false }; },
    markUser: async () => {}, createAgent: async (_uid, data) => { doc = data; },
    deleteUser: async uid => { deleted.push(uid); },
  };
  return { mapping, deps, users, deleted, doc: () => doc!, disable: () => { disabled = true; } };
}
const input = { did: "+61400000000", name: "Trade AI", createdBy: "admin" };

test("Trade AI provisioning creates one booking-only identity per normalized DID", async () => {
  const f = fixture(), provision = createTradeAiAgentProvisioner(f.deps);
  const first = await provision(input), second = await provision(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.firebaseBlueUid, second.firebaseBlueUid);
  assert.equal(tradeAiAgentUid(input.did), tradeAiAgentUid(input.did.slice(1)));
  assert.equal(f.users.length, 1);
  assert.deepEqual(f.doc().assignedBusinessIds, ["business-a"]);
  assert.equal(f.doc().role, "ai_receptionist");
  assert.equal(activeTradeAgent(f.doc(), input.did, "business-b"), false);
});

test("Trade provisioning rejects remapping, suspension, disabled accounts and Black branches", async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.mapping.owner_id = "business-b"; },
    (f: ReturnType<typeof fixture>) => { f.doc().suspended = true; },
    (f: ReturnType<typeof fixture>) => { f.disable(); },
    (f: ReturnType<typeof fixture>) => { f.mapping.branch_id = "black-branch"; }]) {
    const f = fixture(), provision = createTradeAiAgentProvisioner(f.deps);
    await provision(input); change(f);
    await assert.rejects(provision(input));
    assert.equal(f.users.length, 1);
  }
});

test("Trade provisioning never adopts human accounts and cleans up partial identities", async () => {
  const f = fixture();
  f.deps.createUser = async () => { throw Object.assign(new Error("exists"), { code: "auth/uid-already-exists" }); };
  await assert.rejects(createTradeAiAgentProvisioner(f.deps)(input), /already exists/);
  assert.equal(f.deleted.length, 0);
  const failed = fixture();
  failed.deps.createAgent = async () => { throw new Error("Firestore unavailable"); };
  await assert.rejects(createTradeAiAgentProvisioner(failed.deps)(input), /Firestore unavailable/);
  assert.deepEqual(failed.deleted, [tradeAiAgentUid(input.did)]);
});

test("Trade identity caches and refreshes tokens but rechecks scope and account state every time", async () => {
  const f = fixture();
  await createTradeAiAgentProvisioner(f.deps)(input);
  let time = 0, exchanges = 0, disabled = false;
  const claims: Record<string, unknown> = { role: "ai_receptionist", aiFrontOffice: true, brand: "trade" };
  const getToken = createTradeAgentIdentity({
    getMapping: async () => f.mapping,
    getUser: async () => ({ disabled, customClaims: claims }),
    getAgent: async () => f.doc(), createCustomToken: async () => "custom-token",
    exchangeCustomToken: async () => ({ token: `id-token-${++exchanges}`, expiresIn: 3600 }),
  }, () => time);
  assert.deepEqual(await Promise.all([getToken(input.did, "business-a"), getToken(input.did, "business-a")]), ["id-token-1", "id-token-1"]);
  assert.equal(exchanges, 1);
  f.doc().suspended = true;
  await assert.rejects(getToken(input.did, "business-a"), /active Trade AI/);
  f.doc().suspended = false;
  disabled = true;
  await assert.rejects(getToken(input.did, "business-a"), /active Trade AI/);
  disabled = false;
  f.mapping.owner_id = "business-b";
  await assert.rejects(getToken(input.did, "business-a"), /assignment changed/);
  f.mapping.owner_id = "business-a";
  claims.role = "call_center";
  await assert.rejects(getToken(input.did, "business-a"), /active Trade AI/);
  claims.role = "ai_receptionist";
  time = 3_500_000;
  assert.equal(await getToken(input.did, "business-a"), "id-token-2");
});
