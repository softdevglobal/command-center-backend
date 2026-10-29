import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { createTextTestService, TextTestError } from "../src/services/ai/text-test.service.js";
import { createTextTestRouter } from "../src/routes/ai/text-test.routes.js";
import { TextRuntimeError, type TextTestRuntime } from "../src/services/ai/text-test-runtime.service.js";

const start = { mode: "receptionist", brand: "pink", did: "0359111425", acknowledgeRealActions: true };
const reply = (text: string) => ({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 5 } });
const call = (name: string, args = {}) => ({ output: [{ type: "reasoning", encrypted_content: "private-reasoning" }, { type: "function_call", call_id: randomUUID(), name, arguments: JSON.stringify(args) }], usage: { input_tokens: 10, output_tokens: 5 } });

function fixture() {
  const toolCalls: string[] = [], requests: Record<string, unknown>[] = [];
  let opens = 0, closes = 0, clock = 1000;
  const responses: unknown[] = [reply("Hello, I'm Sophie. How can I help?")];
  let requestOverride: typeof fetch | undefined;
  const runtime: TextTestRuntime = { mode: "receptionist", did: "0359111425", brand: "pink", label: "Pink Test Salon", instructions: "Use live tools and require confirmation.",
    tools: ["list_services", "create_booking", "complete_business_onboarding"].map(name => ({ type: "function", name, description: name, parameters: { type: "object", properties: {} }, strict: false })),
    call: async name => { toolCalls.push(name); return name === "list_services" ? [{ id: "cut", name: "Haircut", price: 45 }] : { status: "PENDING_REVIEW", bookingId: "real-service-callback-result" }; },
    close: async () => { closes++; },
  };
  const service = createTextTestService({ autoSweep: false, apiKey: () => "unit-test-key", model: () => "gpt-6-luna", now: () => clock,
    openRuntime: async () => { opens++; return runtime; },
    request: async (url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requestOverride) return requestOverride(url, init);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return Response.json(next ?? reply("Done."));
    },
  });
  return { service, responses, toolCalls, requests, runtime, opens: () => opens, closes: () => closes,
    advance: () => { clock += 16 * 60000; }, override: (value: typeof fetch) => { requestOverride = value; } };
}

test("text tests require explicit acknowledgement, open on demand and send text-only stateless model requests", async () => {
  const f = fixture();
  try {
    assert.equal(f.opens(), 0); assert.equal(f.requests.length, 0);
    await assert.rejects(f.service.start("admin", { ...start, acknowledgeRealActions: false }));
    assert.equal(f.opens(), 0);
    const session = await f.service.start("admin", start);
    assert.equal(session.realActions, true); assert.equal(session.label, "Pink Test Salon");
    const request = f.requests[0]!;
    assert.equal(request.model, "gpt-6-luna"); assert.equal(request.store, false);
    assert.equal(request.parallel_tool_calls, false); assert.equal(request.audio, undefined);
    assert.equal(f.requests.length, 1);
  } finally { await f.service.dispose(); }
});

test("text tool calls invoke the real runtime callback and carry its result and reasoning into the next model request", async () => {
  const f = fixture();
  try {
    const session = await f.service.start("admin", start);
    f.responses.push(call("list_services"), reply("A haircut costs $45."));
    const result = await f.service.message("admin", session.id, { messageId: randomUUID(), text: "What services do you offer?" });
    assert.deepEqual(f.toolCalls, ["list_services"]); assert.equal(result.text, "A haircut costs $45.");
    const input = f.requests.at(-1)!.input as Record<string, unknown>[];
    assert.ok(input.some(item => item.type === "reasoning" && item.encrypted_content === "private-reasoning"));
    assert.ok(input.some(item => item.type === "function_call_output" && String(item.output).includes('"price":45')));
    assert.equal(result.tools[0]!.name, "list_services"); assert.equal(result.usage.requests, 3);
    assert.ok(!JSON.stringify(result).includes("private-reasoning"));
  } finally { await f.service.dispose(); }
});

test("message replay cannot submit a booking twice, and changed text cannot reuse the same message identity", async () => {
  const f = fixture();
  try {
    const session = await f.service.start("admin", start), input = { messageId: randomUUID(), text: "Yes, confirm those booking details." };
    f.responses.push(call("create_booking"), reply("Your request is pending salon review."));
    const [first, second] = await Promise.all([f.service.message("admin", session.id, input), f.service.message("admin", session.id, input)]);
    assert.deepEqual(first, second); assert.deepEqual(f.toolCalls, ["create_booking"]);
    await assert.rejects(f.service.message("admin", session.id, { ...input, text: "Different details" }), error => error instanceof TextTestError && error.status === 409);
    assert.equal(f.requests.length, 3);
  } finally { await f.service.dispose(); }
});

test("Sophie text onboarding executes account creation through its selected real runtime, with no mock feature branch", async () => {
  const f = fixture();
  try {
    f.runtime.mode = "onboarding"; f.runtime.brand = null;
    const session = await f.service.start("admin", { ...start, mode: "onboarding" });
    f.responses.push(call("complete_business_onboarding", { callerConfirmedDetails: true, callerConfirmedAccountCreation: true }), reply("Your business account is set up."));
    await f.service.message("admin", session.id, { messageId: randomUUID(), text: "Yes, the details are correct and I agree to create the account." });
    assert.deepEqual(f.toolCalls, ["complete_business_onboarding"]);
  } finally { await f.service.dispose(); }
});

test("text startup cannot create bookings or accounts, even if a model incorrectly requests it", async () => {
  const f = fixture(); f.responses.splice(0, 1, call("create_booking"), reply("Hello, I'm Sophie."));
  try { await f.service.start("admin", start); assert.equal(f.toolCalls.length, 0); }
  finally { await f.service.dispose(); }
});

test("a model error after submission preserves the live tool outcome and replay does not repeat it", async () => {
  const f = fixture();
  try {
    const session = await f.service.start("admin", start), input = { messageId: randomUUID(), text: "Confirm the booking." };
    f.responses.push(call("create_booking"), new Error("Provider unavailable"));
    const result = await f.service.message("admin", session.id, input);
    assert.equal(result.tools[0]!.status, "PENDING_REVIEW");
    assert.match(result.text, /check any booking or account outcome/i);
    await f.service.message("admin", session.id, input);
    assert.equal(f.toolCalls.length, 1);
  } finally { await f.service.dispose(); }
});

test("sessions are owner-scoped and End test aborts pending model requests and closes the MCP runtime", async () => {
  const f = fixture();
  try {
    const session = await f.service.start("admin", start);
    await assert.rejects(f.service.message("other-admin", session.id, { messageId: randomUUID(), text: "Read this session" }), error => error instanceof TextTestError && error.status === 404);
    await assert.rejects(f.service.end("other-admin", session.id));
    let began!: () => void;
    const ready = new Promise<void>(resolve => { began = resolve; });
    f.override(async (_url, init) => new Promise((_resolve, reject) => { began(); init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }));
    const pending = f.service.message("admin", session.id, { messageId: randomUUID(), text: "Check availability" });
    const observed = assert.rejects(pending, error => error instanceof TextTestError && error.status === 410);
    await ready; await f.service.end("admin", session.id); await observed;
    assert.equal(f.closes(), 1);
    await assert.rejects(f.service.message("admin", session.id, { messageId: randomUUID(), text: "Continue" }));
  } finally { await f.service.dispose(); }
});

test("idle text tests expire independently of customer call state", async () => {
  const f = fixture();
  try {
    const session = await f.service.start("admin", start); f.advance();
    await assert.rejects(f.service.message("admin", session.id, { messageId: randomUUID(), text: "Hello" }), error => error instanceof TextTestError && error.status === 410);
    assert.equal(f.closes(), 1);
  } finally { await f.service.dispose(); }
});

test("text endpoints reject unauthenticated and disabled requests before opening tools", async () => {
  const f = fixture(), app = express(); app.use(express.json());
  app.use("/enabled", createTextTestRouter({ service: f.service, enabled: () => true }));
  app.use("/disabled", createTextTestRouter({ service: f.service, enabled: () => false }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  try {
    for (const [path, expected] of [["enabled", 401], ["disabled", 404]] as const) {
      const response = await fetch(`http://127.0.0.1:${address.port}/${path}/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(start) });
      assert.equal(response.status, expected);
    }
    assert.equal(f.opens(), 0); assert.equal(f.requests.length, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await f.service.dispose(); }
});

test("authenticated HTTP startup returns the greeting and preserves a useful MCP failure stage", async () => {
  const f = fixture(), app = express(); app.use(express.json());
  const authorize = [(_req: express.Request, res: express.Response, next: express.NextFunction) => { res.locals.supabaseAuth = { user: { id: "admin" } }; next(); }];
  app.use("/ok", createTextTestRouter({ service: f.service, authorize, enabled: () => true }));
  const broken = createTextTestService({ autoSweep: false, apiKey: () => "test-key", openRuntime: async () => { throw new TextRuntimeError(503, "business_profile", 403, "The selected AI receptionist is inactive."); } });
  app.use("/broken", createTextTestRouter({ service: broken, authorize, enabled: () => true }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  try {
    for (const path of ["ok", "broken"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/${path}/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(start) });
      const body = await response.json();
      if (path === "ok") { assert.equal(response.status, 200); assert.match(body.text, /Sophie/); }
      else { assert.equal(response.status, 503); assert.equal(body.stage, "business_profile"); assert.equal(body.mcpStatus, 403); assert.match(body.error, /inactive/); }
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await f.service.dispose(); await broken.dispose(); }
});
