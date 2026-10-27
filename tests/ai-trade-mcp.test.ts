import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import tradeRouter, { createTradeMcpServer, tradeMcpToolFailure } from "../src/routes/ai/trade-mcp.routes.js";
import { TradeAgentIdentityError } from "../src/services/ai/trade-agent-identity.service.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { DidMappingRow } from "../src/types/did-mapping.types.js";
import { resolveTradeDidMapping, authenticateTradeMcpRequest } from "../src/services/ai/trade-front-office.service.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { authenticateTradeMcp, parseTradeMcpTenants, submitTradeOnce, tradeRequestArguments, tradeAvailabilityArguments, type TradeSubmissionStore, type TradeSubmissionResult } from "../src/services/ai/trade-front-office.service.js";

const token = "trade-test-credential-".padEnd(40, "x");
const tenant = { did: "+61400000001", token };

test("receptionist setup failures are distinct from uncertain submission outcomes", () => {
  const setup = tradeMcpToolFailure("create_inspection_request", new TradeAgentIdentityError("Private setup details"));
  const setupBody = JSON.parse(setup.content[0]!.text);
  assert.equal(setup.isError, true);
  assert.equal(setupBody.status, "REJECTED");
  assert.equal(setupBody.code, "RECEPTIONIST_SETUP_REQUIRED");
  assert.match(setupBody.message, /did not submit/);
  assert.doesNotMatch(setupBody.message, /Private setup details/);
  const uncertain = JSON.parse(tradeMcpToolFailure("create_inspection_request", new Error("lost response")).content[0]!.text);
  assert.equal(uncertain.status, "UNKNOWN");
  assert.match(uncertain.message, /original requestKey/);
  const read = JSON.parse(tradeMcpToolFailure("get_available_slots", new Error("unavailable")).content[0]!.text);
  assert.equal(read.status, "UNAVAILABLE");
  assert.match(read.message, /do not invent availability/i);
});

test("Trade resolves the existing DID owner_id and re-reads changed mappings without a branch", async () => {
  let mapping: DidMappingRow | null = { did: tenant.did, tenant_id: "tenant-a", queue_id: "queue-blue", label: "Trade", owner_id: "business-a", workshop_name: "Trade A", branch_id: "", branch_name: "" };
  const lookup = async (did: string) => did === tenant.did ? mapping : null;
  const queueLookup = async (queueId: string, tenantId: string) => ({ id: queueId, name: "Blue Queue", type: "blue", tenant_id: tenantId });
  assert.equal((await resolveTradeDidMapping("61400000001", lookup, undefined, queueLookup)).businessId, "business-a");
  assert.equal((await resolveTradeDidMapping(tenant.did, lookup, "business-a", queueLookup)).businessId, "business-a");
  mapping.owner_id = "business-b";
  await assert.rejects(resolveTradeDidMapping(tenant.did, lookup, "business-a", queueLookup));
  assert.equal((await resolveTradeDidMapping(tenant.did, lookup, undefined, queueLookup)).businessId, "business-b");
  mapping.branch_id = "black-branch";
  await assert.rejects(resolveTradeDidMapping(tenant.did, lookup, undefined, queueLookup));
  mapping.branch_id = "";
  await assert.rejects(resolveTradeDidMapping(tenant.did, async () => mapping, undefined, queueLookup));
  mapping = null;
  await assert.rejects(resolveTradeDidMapping(tenant.did, lookup));
});

test("bridge authentication follows Black's secret plus DID header flow", async () => {
  const names = ["AI_VOICE_BRIDGE_SECRET", "AI_MCP_TRADE_TENANT_CONFIG_JSON", "AI_MCP_TENANT_CONFIG_JSON"];
  const previous = names.map(name => process.env[name]);
  const bridge = "bridge-test-secret-".padEnd(40, "z");
  Object.assign(process.env, { AI_VOICE_BRIDGE_SECRET: bridge, AI_MCP_TRADE_TENANT_CONFIG_JSON: JSON.stringify([tenant]), AI_MCP_TENANT_CONFIG_JSON: "[]" });
  const mapping: DidMappingRow = { did: tenant.did, tenant_id: "tenant-a", queue_id: "blue", label: "Trade", owner_id: "business-a", workshop_name: "Trade", branch_id: null, branch_name: null };
  const lookup = async (did: string) => did === tenant.did ? mapping : null;
  const queueLookup = async (queueId: string, tenantId: string) => ({ id: queueId, name: "Blue Queue", type: "blue", tenant_id: tenantId });
  try {
    assert.equal((await authenticateTradeMcpRequest(bridge, "61400000001", lookup, queueLookup))?.did, tenant.did);
    assert.equal(await authenticateTradeMcpRequest(bridge, "", lookup), undefined);
    assert.equal(await authenticateTradeMcpRequest(bridge, "+61400000001", lookup), undefined);
    assert.equal(await authenticateTradeMcpRequest(bridge, "61400000002", lookup, queueLookup), undefined);
    assert.equal(await authenticateTradeMcpRequest("wrong", "61400000001", lookup), undefined);
    assert.equal((await authenticateTradeMcpRequest(token, "61400000002", lookup))?.did, tenant.did);
    mapping.branch_id = "black-branch";
    assert.equal(await authenticateTradeMcpRequest(bridge, "61400000001", lookup, queueLookup), undefined);
  } finally {
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});

test("SDK initialization advertises scoped Trade tools and gates the write tool", async () => {
  const previous = process.env.AI_MCP_TRADE_REQUESTS_ENABLED;
  try {
    for (const enabled of [false, true]) {
      process.env.AI_MCP_TRADE_REQUESTS_ENABLED = String(enabled);
      const server = createTradeMcpServer(tenant);
      const client = new Client({ name: "trade-test", version: "1.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const tools = (await client.listTools()).tools;
        assert.deepEqual(tools.map(tool => tool.name).sort(), ["get_business_profile", "list_services", "get_available_slots", ...(enabled ? ["create_inspection_request"] : [])].sort());
        for (const tool of tools) {
          const properties = tool.inputSchema.properties ?? {};
          assert.equal("businessId" in properties, false);
          assert.equal("slug" in properties, false);
        }
        if (enabled) {
          const result = await client.callTool({ name: "create_inspection_request", arguments: { ...input, customerConfirmed: false } });
          assert.equal(result.isError, true);
        }
      } finally { await client.close(); await server.close(); }
    }
  } finally {
    if (previous === undefined) delete process.env.AI_MCP_TRADE_REQUESTS_ENABLED; else process.env.AI_MCP_TRADE_REQUESTS_ENABLED = previous;
  }
});

test("tenant configuration rejects ambiguous DIDs, reused credentials and document paths", () => {
  assert.equal(authenticateTradeMcp(token, parseTradeMcpTenants(JSON.stringify([tenant])))?.did, tenant.did);
  assert.equal(authenticateTradeMcp("incorrect", [tenant]), undefined);
  assert.throws(() => parseTradeMcpTenants(JSON.stringify([tenant, { ...tenant, did: "61400000001", token: token + "other" }])));
  assert.throws(() => parseTradeMcpTenants(JSON.stringify([tenant, { ...tenant, did: "+61400000002" }])));
  assert.throws(() => parseTradeMcpTenants(JSON.stringify([{ ...tenant, businessId: "businesses/other" }])));
  assert.throws(() => parseTradeMcpTenants(JSON.stringify([{ ...tenant, token: "short" }])));
});

const input = {
  requestKey: "request-key-0000001", customerConfirmed: true, serviceId: "service-a",
  customer: { fullName: "Test Customer", email: "test@example.invalid", phone: "+61400000000" },
  address: { street: "1 Test Street", suburb: "Melbourne", state: "VIC", postcode: "3000" },
  preferredSlots: [{ date: "2026-11-01", timeRange: "morning" }],
};
test("request tools reject missing confirmation, invalid dates and caller-controlled tenant/status fields", () => {
  assert.equal(tradeRequestArguments.parse(input).budgetAud, null);
  for (const patch of [{ customerConfirmed: false }, { businessId: "other" }, { slug: "other" }, { status: "scheduled" }, { preferredSlots: [{ date: "2026-02-30", timeRange: "morning" }] }, { preferredSlots: [] }, { budgetAud: -1 }]) {
    assert.equal(tradeRequestArguments.safeParse({ ...input, ...patch }).success, false);
  }
  assert.equal(tradeAvailabilityArguments.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success, false);
});

function memoryStore(): TradeSubmissionStore {
  const entries = new Map<string, { fingerprint: string; result?: TradeSubmissionResult }>();
  return {
    async claim(key, fingerprint) { const entry = entries.get(key); if (entry) return entry; entries.set(key, { fingerprint }); return null; },
    async complete(key, result) { entries.get(key)!.result = result; },
  };
}
test("durable claims prevent parallel/repeated writes, isolate businesses and reject changed payloads", async () => {
  const store = memoryStore(); let writes = 0;
  const send = async (): Promise<TradeSubmissionResult> => { writes++; return { status: "PENDING_REVIEW", requestId: "request-a", message: "Submitted for review." }; };
  const results = await Promise.all([submitTradeOnce(store, "business-a", "key", input, send), submitTradeOnce(store, "business-a", "key", input, send)]);
  assert.equal(writes, 1);
  assert.ok(results.some(result => result.status === "PENDING_REVIEW"));
  assert.equal((await submitTradeOnce(store, "business-a", "key", input, send)).status, "PENDING_REVIEW");
  assert.equal((await submitTradeOnce(store, "business-a", "key", { ...input, serviceId: "changed" }, send)).status, "REJECTED");
  await submitTradeOnce(store, "business-b", "key", input, send);
  assert.equal(writes, 2);
});
test("timeouts and lost completion writes never trigger a second upstream submission", async () => {
  const store = memoryStore(); let writes = 0;
  const send = async (): Promise<TradeSubmissionResult> => { writes++; throw new Error("timeout after upstream save"); };
  assert.equal((await submitTradeOnce(store, "business-a", "key", input, send)).status, "UNKNOWN");
  assert.equal((await submitTradeOnce(store, "business-a", "key", input, send)).status, "UNKNOWN");
  assert.equal(writes, 1);
  const lostStore = memoryStore(); lostStore.complete = async () => { throw new Error("database unavailable"); };
  await assert.rejects(submitTradeOnce(lostStore, "business-a", "key", input, send));
  assert.equal((await submitTradeOnce(lostStore, "business-a", "key", input, send)).status, "UNKNOWN");
  assert.equal(writes, 2);
});

test("HTTP endpoint is gated and rejects unauthenticated clients before database access", async () => {
  const names = ["AI_FEATURE_ENABLED", "AI_VOICE_PROVIDER", "AI_MCP_ENABLED", "AI_MCP_TRADE_ENABLED", "AI_MCP_TRADE_TENANT_CONFIG_JSON"];
  const previous = names.map(name => process.env[name]);
  const app = express(); app.use(express.json()); app.use("/api/ai/mcp/trade", tradeRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/ai/mcp/trade`;
  try {
    process.env.AI_MCP_TRADE_ENABLED = "false";
    assert.equal((await fetch(url, { method: "POST" })).status, 404);
    Object.assign(process.env, { AI_FEATURE_ENABLED: "true", AI_VOICE_PROVIDER: "yeastar", AI_MCP_ENABLED: "true", AI_MCP_TRADE_ENABLED: "true", AI_MCP_TRADE_TENANT_CONFIG_JSON: JSON.stringify([tenant]) });
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await fetch(url)).status, 405);
    process.env.AI_MCP_TRADE_TENANT_CONFIG_JSON = "invalid";
    assert.equal((await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});
