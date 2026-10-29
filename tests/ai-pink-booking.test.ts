import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPinkBookingTools, type PinkSlotOffer, type PinkSubmissionRecord, type PinkSubmission } from "../src/services/bms_pink/pink-booking.service.js";
import { createPinkMcpServer } from "../src/routes/bms_pink/ai-mcp.routes.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { proxyPinkCallCenterCreateBooking } from "../src/services/bms_pink/pink-call-center-bookings.proxy.service.js";

function fixture() {
  const scope = { did: "0359111425", token: "private-test-token", ownerUid: "pink-owner", branchId: "pink-branch", pinkAgentUid: "ai-pink-test" };
  let now = new Date("2026-10-28T03:00:00Z"), enabled = true, slots: unknown[] = ["09:00", "15:00"], active = true;
  let response = { ok: true, status: 201, body: { bookingId: "pink-booking", status: "Pending" } as Record<string, unknown> };
  let timeout = false, ledgerFailure = false;
  const offers = new Map<string, PinkSlotOffer>(), submissions = new Map<string, PinkSubmissionRecord>(), writes: Record<string, unknown>[] = [];
  const tools = createPinkBookingTools({
    scope: async () => ({ ...scope }), branch: async () => ({ timezone: "Australia/Sydney" }),
    services: async () => active ? [{ id: "cut", name: "Haircut", duration: 30, price: 45 }] : [],
    availability: async () => ({ availableSlots: slots }),
    saveOffer: async (token, offer) => { offers.set(token, offer); }, readOffer: async token => offers.get(token),
    readSubmission: async key => submissions.get(key),
    claim: async (key, fingerprint) => { const existing = submissions.get(key); if (!existing) submissions.set(key, { fingerprint }); return existing; },
    complete: async (key, result: PinkSubmission) => { if (ledgerFailure) throw new Error("Storage unavailable"); submissions.get(key)!.result = result; },
    submit: async (_tenant, payload) => { writes.push(payload); if (timeout) throw new Error("Response lost"); return response; },
    enabled: () => enabled, now: () => now,
  });
  const offer = async (date = "2026-10-29") => (await tools.getAvailableSlots({ date, serviceIds: ["cut"] })).slots[0]!.slotToken;
  return { tools, offer, scope, writes, offers, submissions, disable: () => { enabled = false; }, deactivate: () => { active = false; },
    advance: (milliseconds = 6 * 60000) => { now = new Date(now.getTime() + milliseconds); }, setSlots: (value: unknown[]) => { slots = value; },
    setResponse: (value: typeof response) => { response = value; }, timeout: () => { timeout = true; }, failLedger: () => { ledgerFailure = true; } };
}
const contact = { requestKey: "pink-request-00000001", customerConfirmed: true, customerName: "Test Client", customerEmail: "TEST@example.test", customerPhone: "+61400000000" };

test("Pink availability uses branch timezone, filters past/unavailable/duplicate slots and rejects invalid dates and services", async () => {
  const f = fixture();
  f.setSlots(["09:00", "15:00", "15:00", { time: "16:00", available: false }, "invalid"]);
  const result = await f.tools.getAvailableSlots({ date: "2026-10-28", serviceIds: ["cut"] });
  assert.equal(result.timezone, "Australia/Sydney");
  assert.deepEqual(result.slots.map(slot => slot.time), ["15:00"]);
  assert.equal(f.offers.size, 1);
  await assert.rejects(f.tools.getAvailableSlots({ date: "2026-02-30", serviceIds: ["cut"] }));
  await assert.rejects(f.tools.getAvailableSlots({ date: "2026-10-27", serviceIds: ["cut"] }));
  await assert.rejects(f.tools.getAvailableSlots({ date: "2026-10-29", serviceIds: ["other-salon-service"] }));
  await assert.rejects(f.tools.getAvailableSlots({ date: "2026-10-29", serviceIds: ["cut", "cut"] }));
});

test("Pink submission requires confirmation and rejects caller-selected salon fields before writing", async () => {
  const f = fixture(), slotToken = await f.offer();
  await assert.rejects(f.tools.createBooking({ ...contact, slotToken, customerConfirmed: false }));
  await assert.rejects(f.tools.createBooking({ ...contact, slotToken, ownerUid: "another-salon" }));
  await assert.rejects(f.tools.createBooking({ ...contact, slotToken, customerEmail: "invalid" }));
  assert.equal(f.writes.length, 0);
});

test("expired offers, remapped branches and deactivated services cannot submit a Pink booking", async () => {
  for (const change of ["expired", "remapped", "inactive"] as const) {
    const f = fixture(), slotToken = await f.offer();
    if (change === "expired") f.advance();
    if (change === "remapped") f.scope.branchId = "another-branch";
    if (change === "inactive") f.deactivate();
    const result = await f.tools.createBooking({ ...contact, slotToken });
    assert.ok(["EXPIRED_SLOT", "REJECTED"].includes(result.status));
    assert.equal(f.writes.length, 0);
  }
});

test("Pink rechecks availability and never submits an unavailable time", async () => {
  const f = fixture(), slotToken = await f.offer(); f.setSlots([]);
  assert.equal((await f.tools.createBooking({ ...contact, slotToken })).status, "REJECTED");
  assert.equal(f.writes.length, 0);
});

test("a Pink appointment that passes while the caller confirms cannot be submitted even before offer expiry", async () => {
  const f = fixture(); f.setSlots(["14:01"]);
  const slotToken = await f.offer("2026-10-28"); f.advance(2 * 60000);
  assert.equal((await f.tools.createBooking({ ...contact, slotToken })).status, "EXPIRED_SLOT");
  assert.equal(f.writes.length, 0);
});

test("concurrent and repeated Pink requests submit once and recover the outcome after offer expiry", async () => {
  const f = fixture(), slotToken = await f.offer(), args = { ...contact, slotToken };
  await Promise.all([f.tools.createBooking(args), f.tools.createBooking(args)]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0]!.branchId, "pink-branch");
  assert.equal(f.writes[0]!.clientEmail, "test@example.test");
  f.advance();
  assert.equal((await f.tools.createBooking(args)).status, "PENDING_REVIEW");
  assert.equal((await f.tools.createBooking({ ...args, customerName: "Changed Client" })).status, "REJECTED");
  assert.equal(f.writes.length, 1);
});

test("uncertain Pink submissions and failed ledger writes cannot trigger another upstream write", async () => {
  for (const mode of ["timeout", "ledger"] as const) {
    const f = fixture(), args = { ...contact, slotToken: await f.offer() };
    if (mode === "timeout") f.timeout(); else f.failLedger();
    assert.equal((await f.tools.createBooking(args)).status, "UNKNOWN");
    assert.equal((await f.tools.createBooking(args)).status, "UNKNOWN");
    assert.equal(f.writes.length, 1);
  }
});

test("only an explicit upstream confirmation confirms Pink; malformed success and server errors remain uncertain", async () => {
  for (const [body, httpStatus, expected] of [
    [{ booking: { id: "booking", status: "Confirmed" } }, 201, "CONFIRMED"],
    [{ bookingId: "booking", status: "Pending" }, 201, "PENDING_REVIEW"],
    [{ success: true }, 201, "UNKNOWN"], [{ error: "timeout" }, 504, "UNKNOWN"], [{ error: "invalid" }, 400, "REJECTED"],
  ] as const) {
    const f = fixture(), slotToken = await f.offer();
    f.setResponse({ ok: httpStatus < 400, status: httpStatus, body: { ...body } });
    assert.equal((await f.tools.createBooking({ ...contact, slotToken })).status, expected);
  }
});

test("Pink write flag controls both submission and MCP tool advertisement", async () => {
  const f = fixture(); f.disable();
  assert.equal((await f.tools.createBooking({ ...contact, slotToken: randomUUID() })).status, "DISABLED");
  assert.equal(f.writes.length, 0);
  const before = process.env.AI_MCP_PINK_BOOKINGS_ENABLED;
  try {
    for (const enabled of [false, true]) {
      process.env.AI_MCP_PINK_BOOKINGS_ENABLED = String(enabled);
      const server = createPinkMcpServer(f.scope), client = new Client({ name: "pink-offline-check", version: "1" }, { capabilities: {} });
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport); await client.connect(clientTransport);
      const tools = (await client.listTools()).tools.map(tool => tool.name);
      assert.equal(tools.includes("create_booking"), enabled);
      assert.ok(tools.includes("get_business_profile"));
      assert.ok(!tools.includes("get_workshop_profile"));
      await client.close(); await server.close();
    }
  } finally { if (before === undefined) delete process.env.AI_MCP_PINK_BOOKINGS_ENABLED; else process.env.AI_MCP_PINK_BOOKINGS_ENABLED = before; }
});

test("Pink upstream submission carries salon auth, the durable request key and a bounded timeout", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(new URL(url).pathname, "/api/call-center/bookings");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-pink-token");
    assert.equal(headers.get("X-Tenant-Id"), "pink-owner");
    assert.equal(headers.get("Idempotency-Key"), contact.requestKey);
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { branchId: "pink-branch", source: "ai_reception" });
    return Response.json({ bookingId: "mock-only", status: "Pending" }, { status: 201 });
  });
  const response = await proxyPinkCallCenterCreateBooking("test-pink-token", "pink-owner", { branchId: "pink-branch", source: "ai_reception" }, contact.requestKey);
  assert.equal(response.status, 201); assert.equal(calls, 1);
});
