import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEmailBusinessLookup, registerSophieBusinessInformationTools } from "../src/services/ai/sophie-business-information.service.js";
import { businessKnowledgeSchema, businessNameKey } from "../src/services/ai/sophie-business-knowledge.service.js";
import type { DidMappingRow } from "../src/types/did-mapping.types.js";

function mapping(overrides: Partial<DidMappingRow> = {}): DidMappingRow {
  return { did: "0359111403", tenant_id: "tenant-private", queue_id: "queue-private", owner_id: "owner-private", label: "internal label", workshop_name: "Example Motors", branch_name: "Central", branch_id: "branch-private", ...overrides };
}

test("ambiguous branches issue no reference and cannot be guessed into a detail lookup", async () => {
  let reads = 0;
  const lookup = createEmailBusinessLookup({
    listMappings: async () => [mapping(), mapping({ did: "0359111404", branch_id: "other-private", branch_name: "North" })],
    getBrand: async () => "black",
    blackProfile: async () => { reads += 1; return {}; },
  });
  const result = await lookup.findBusiness({ businessName: "Example Motors" });
  assert.equal(result.status, "clarification_required");
  assert.equal("businessRef" in result, false);
  assert.equal((await lookup.getBusinessDetails("owner-private")).status, "not_found");
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(result).includes("owner-private"), false);
});

test("Black business lookup reuses the assigned branch and returns only public facts", async () => {
  const row = mapping();
  const lookup = createEmailBusinessLookup({
    listMappings: async () => [row], getMapping: async () => row, getBrand: async () => "black",
    blackProfile: async (context) => { assert.equal(context.ownerId, row.owner_id); assert.equal(context.branchId, row.branch_id); return { address: "Public address", phone: "Public phone", internalNotes: "secret", ownerId: row.owner_id }; },
    blackServices: async () => [{ name: "General service", price: 120, customerEmail: "private@example.test", internalCost: 80 }],
  });
  const found = await lookup.findBusiness({ businessName: "Example Motors", branchName: "Central" });
  assert.equal(found.status, "found");
  assert.ok(found.businessRef);
  const details = await lookup.getBusinessDetails(found.businessRef);
  assert.equal(details.status, "found");
  assert.deepEqual(details.profile, { address: "Public address", phone: "Public phone" });
  assert.deepEqual(details.services, [{ name: "General service", price: 120 }]);
  assert.equal(JSON.stringify(details).includes("secret"), false);
});

test("changed DID assignments invalidate references before reading business data", async () => {
  const row = mapping();
  let reads = 0;
  const lookup = createEmailBusinessLookup({
    listMappings: async () => [row], getMapping: async () => ({ ...row, owner_id: "reassigned-owner" }), getBrand: async () => "black",
    blackProfile: async () => { reads += 1; return {}; },
  });
  const found = await lookup.findBusiness({ businessName: "Example Motors" });
  assert.ok(found.businessRef);
  assert.equal((await lookup.getBusinessDetails(found.businessRef)).status, "unavailable");
  assert.equal(reads, 0);
});

test("Trade lookup pins business scope and references do not cross email sessions", async () => {
  const row = mapping({ branch_id: null, branch_name: null });
  const dependencies = {
    listMappings: async () => [row], getMapping: async () => row, getBrand: async () => "trade" as const,
    tradeProfile: async (scope: { did: string; pinnedBusinessId?: string }) => {
      assert.equal(scope.pinnedBusinessId, row.owner_id);
      return { businessName: "Example Motors", phone: "Public phone", businessId: row.owner_id, billingStatus: "private" };
    },
    tradeServices: async () => [{ name: "Drain inspection", defaultDurationMin: 30, id: "internal-service-id" }],
  };
  const firstSession = createEmailBusinessLookup(dependencies);
  const secondSession = createEmailBusinessLookup(dependencies);
  const found = await firstSession.findBusiness({ businessName: "Example Motors", product: "trade" });
  assert.ok(found.businessRef);
  assert.equal((await secondSession.getBusinessDetails(found.businessRef)).status, "not_found");
  const details = await firstSession.getBusinessDetails(found.businessRef);
  assert.deepEqual(details.profile, { businessName: "Example Motors", phone: "Public phone" });
  assert.deepEqual(details.services, [{ name: "Drain inspection", defaultDurationMin: 30 }]);
});

test("business knowledge requires explicit scope and a full name for business entries", () => {
  const entry = { scope: "business", product: "black", title: "Opening hours", content: "Approved public hours", published: false };
  assert.equal(businessKnowledgeSchema.safeParse(entry).success, false);
  assert.equal(businessKnowledgeSchema.safeParse({ ...entry, businessName: "Example Motors" }).success, true);
  assert.equal(businessKnowledgeSchema.safeParse({ ...entry, scope: "bms_pros" }).success, true);
  assert.equal(businessNameKey(" Éxample  Motors! "), "example motors");
});

test("email information MCP exposes only lookup tools and rejects unknown session references", async () => {
  const server = new McpServer({ name: "sophie-business-test", version: "1" });
  registerSophieBusinessInformationTools(server);
  const client = new Client({ name: "offline-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["find_business", "get_business_details", "search_business_information"]);
    const result = await client.callTool({ name: "get_business_details", arguments: { businessRef: "00000000-0000-4000-8000-000000000000" } });
    assert.ok(Array.isArray(result.content));
    assert.match(JSON.stringify(result.content), /not_found/);
  } finally { await client.close(); await server.close(); }
});
