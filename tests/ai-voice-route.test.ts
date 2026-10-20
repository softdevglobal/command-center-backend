import assert from "node:assert/strict";
import test from "node:test";
import { resolveVoiceProductForDid } from "../src/services/ai/voice-route.service.js";
import type { DidMappingRow } from "../src/types/did-mapping.types.js";

const base: DidMappingRow = {
  did: "0359111403", tenant_id: "tenant-a", queue_id: "q-blue-001", label: "Blue",
  owner_id: "business-a", workshop_name: "Trade A", branch_id: "", branch_name: "",
};

test("DID product routing follows the mapped Blue queue, without a bridge DID list", async () => {
  const mappingLookup = async (did: string) => did === base.did ? base : null;
  const queueLookup = async (queueId: string, tenantId: string) => ({ id: queueId, name: "Blue Queue", type: "inbound", tenant_id: tenantId });
  assert.deepEqual(await resolveVoiceProductForDid(base.did, mappingLookup, queueLookup), { brand: "trade", did: base.did });
});

test("Black DID routing requires its mapped branch and preserves the Black queue", async () => {
  const mapping = { ...base, queue_id: "q-black-001", branch_id: "branch-a" };
  const mappingLookup = async (did: string) => did === mapping.did ? mapping : null;
  const queueLookup = async (queueId: string, tenantId: string) => ({ id: queueId, name: "Reception", type: "inbound", tenant_id: tenantId });
  assert.deepEqual(await resolveVoiceProductForDid(mapping.did, mappingLookup, queueLookup), { brand: "black", did: mapping.did });
});

test("voice product routing rejects missing, duplicate, cross-tenant and structurally invalid mappings", async () => {
  await assert.rejects(resolveVoiceProductForDid("0359111403", async () => null, async () => null));
  await assert.rejects(resolveVoiceProductForDid("0359111403", async did => did.startsWith("+") ? { ...base, did: `+${base.did}` } : base, async () => ({ id: base.queue_id, name: "Blue Queue", type: "blue", tenant_id: base.tenant_id })));
  await assert.rejects(resolveVoiceProductForDid(base.did, async did => did === base.did ? base : null, async () => ({ id: base.queue_id, name: "Blue Queue", type: "blue", tenant_id: "another-tenant" })));
  await assert.rejects(resolveVoiceProductForDid(base.did, async did => did === base.did ? { ...base, branch_id: "black-branch" } : null, async () => ({ id: base.queue_id, name: "Blue Queue", type: "blue", tenant_id: base.tenant_id })));
  await assert.rejects(resolveVoiceProductForDid(base.did, async did => did === base.did ? { ...base, branch_id: "" } : null, async () => ({ id: "q-black-001", name: "Reception", type: "inbound", tenant_id: base.tenant_id })));
});
