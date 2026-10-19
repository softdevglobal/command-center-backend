import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createOnboardingMcpServer, createOnboardingRouters } from "../src/routes/ai/onboarding.routes.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createOnboardingService, OnboardingError, type OnboardingRecord, type OnboardingRepository } from "../src/services/ai/onboarding.service.js";
import { onboardingConfiguration } from "../src/services/ai/onboarding.schemas.js";
import { AiAgentSetupError, createAiAgentProvisioner } from "../src/services/ai/black-ai-agent-provisioning.service.js";
import { createLiveOnboardingTools, onboardingDraftIdForCall, liveAgentMode } from "../src/services/ai/live-onboarding.service.js";
import { createOpenAiLiveRouter } from "../src/routes/ai/openai-live.routes.js";
import WebSocket, { WebSocketServer } from "ws";
import { createOnboardingCallRouter } from "../src/routes/ai/onboarding-call.routes.js";

const operator = "operator-a";
const completeConfig = {
  setupMode: "existing_business" as const,
  product: "black" as const,
  business: { tradingName: "Pilot Workshop", ownerName: "Owner", ownerEmail: "owner@example.test", ownerPhone: "+61400000000", address: "1 Test Street", timezone: "Australia/Sydney" },
  services: [{ name: "Diagnostic", durationMinutes: 60, priceBasis: "Quote after workshop review" }],
  businessHours: [{ day: 1, opens: "09:00", closes: "17:00" }],
  staff: [{ name: "Mechanic", skills: ["Diagnostics"] }],
  receptionistName: "Pilot AI",
  did: "+61400000000",
  escalation: { name: "Workshop team", phone: "+61400000001", afterHoursAction: "callback" as const },
  bookingPolicy: "staff_approval_required" as const,
  cancellationPolicy: "Contact staff to review cancellations.",
  terms: { version: "pilot-1", billingSummary: "Pilot charges reviewed separately", privacySummary: "Pilot notice supplied by owner", recording: "disabled" as const, retentionDays: 0, marketingEnabled: false as const },
};

function fixture() {
  const records = new Map<string, OnboardingRecord>();
  const events: string[] = [];
  const repository: OnboardingRepository = {
    async get(id) { return structuredClone(records.get(id) ?? null); },
    async insert(row) {
      if (records.has(row.id)) return null;
      records.set(row.id, structuredClone(row)); events.push(row.last_action);
      return structuredClone(row);
    },
    async replace(previous, next) {
      if (records.get(previous.id)?.version !== previous.version) return null;
      records.set(next.id, structuredClone(next)); events.push(next.last_action);
      return structuredClone(next);
    },
  };
  const mapping = { did: completeConfig.did, tenant_id: "tenant-a", owner_id: "owner-a", branch_id: "branch-a", queue_id: "queue-a", label: "Pilot", workshop_name: "Pilot Workshop", branch_name: "Pilot Branch" };
  let clock = new Date("2026-10-16T00:00:00Z");
  let attempts = 0;
  let businessAttempts = 0;
  let fail = false;
  const service = createOnboardingService({
    repository, getMapping: async () => mapping, now: () => clock,
    provision: async input => {
      attempts++;
      assert.equal(input.expectedAssignment?.ownerUid, "owner-a");
      if (fail) throw new Error("private provider error with sensitive details");
      return { firebaseBlackUid: "ai-black-pilot", did: input.did, name: input.name, created: true };
    },
    provisionBlackBusiness: async input => {
      businessAttempts++;
      assert.equal(input.approval.configurationHash, input.configurationHash);
      return { status: "TEST_MODE", ownerUid: input.approval.ownerUid, branchId: "new-branch", serviceIds: ["new-service"], staffIds: ["new-staff"], created: true };
    },
  });
  async function reviewed() {
    const created = await service.saveDraft(operator, { draftId: randomUUID(), expectedVersion: 0, configuration: completeConfig });
    return service.submitForReview(operator, { draftId: created.draftId, expectedVersion: created.version });
  }
  async function approved() {
    const review = await reviewed();
    return service.approveAsOwner("owner-a", { draftId: review.draftId, expectedVersion: review.version, accepted: true });
  }
  return { service, records, events, mapping, reviewed, approved, attempts: () => attempts, businessAttempts: () => businessAttempts, setFailure: (value: boolean) => { fail = value; }, advance: () => { clock = new Date(clock.getTime() + 6 * 60 * 1000); } };
}

function newBusinessConfiguration() {
  return { ...completeConfig, setupMode: "new_business" as const, branchName: "New workshop", capacity: 2, bookingLimitPerDay: 8,
    business: { ...completeConfig.business, gstRegistered: true },
    services: [{ ...completeConfig.services[0]!, gstInclusive: true, vehicleTypePricing: { small_car: { price: 120, duration: 60 } } }],
    staff: [{ ...completeConfig.staff[0]!, email: "staff@example.test", workingDays: [1], serviceNames: ["Diagnostic"] }],
  };
}

test("new Black business review uses verified owner email without requiring a pre-existing workshop mapping", async () => {
  const f = fixture(); f.mapping.owner_id = "an-unrelated-existing-workshop";
  const saved = await f.service.saveDraft(operator, { draftId: randomUUID(), expectedVersion: 0, configuration: newBusinessConfiguration() });
  const review = await f.service.submitForReview(operator, { draftId: saved.draftId, expectedVersion: saved.version });
  assert.equal(review.status, "owner_review");
  assert.match(review.ownerReviewUrl!, /\/onboarding\//);
  await assert.rejects(f.service.getOwnerReview({ uid: "new-owner", email: "owner@example.test", emailVerified: false }, saved.draftId), errorCode("NOT_FOUND"));
  await assert.rejects(f.service.getOwnerReview({ uid: "other", email: "other@example.test", emailVerified: true }, saved.draftId), errorCode("NOT_FOUND"));
  const owner = { uid: "new-owner", email: "owner@example.test", emailVerified: true };
  assert.equal((await f.service.getOwnerReview(owner, saved.draftId)).version, review.version);
  const approved = await f.service.approveAsOwner(owner, { draftId: saved.draftId, expectedVersion: review.version, accepted: true });
  const result = await f.service.provisionApprovedBusiness(operator, { draftId: saved.draftId, expectedVersion: approved.version });
  assert.equal(result.status, "provisioned");
  assert.equal(result.liveCallsActivated, false);
  assert.equal(f.businessAttempts(), 1);
  assert.equal(f.attempts(), 0);
  assert.equal((result.provisioningResult as { status: string }).status, "TEST_MODE");
});

test("new business setup blocks missing pricing, GST choices, staff emails and schedules before owner review", async () => {
  const f = fixture();
  const saved = await f.service.saveDraft(operator, { draftId: randomUUID(), expectedVersion: 0,
    configuration: { ...completeConfig, setupMode: "new_business" } });
  assert.ok(saved.missingInformation.includes("branchName"));
  assert.ok(saved.missingInformation.includes("services.0.vehicleTypePricing"));
  assert.ok(saved.missingInformation.includes("business.gstRegistered"));
  assert.ok(saved.missingInformation.includes("staff.0.unique_email"));
  await assert.rejects(f.service.submitForReview(operator, { draftId: saved.draftId, expectedVersion: saved.version }), errorCode("INCOMPLETE_SETUP"));
});

function errorCode(code: string) { return (error: unknown) => error instanceof OnboardingError && error.code === code; }

test("draft creation is idempotent and incomplete drafts report missing information without provisioning", async () => {
  const f = fixture();
  const input = { draftId: randomUUID(), expectedVersion: 0, configuration: { product: "black" as const } };
  const first = await f.service.saveDraft(operator, input);
  const retry = await f.service.saveDraft(operator, input);
  assert.deepEqual(first, retry);
  assert.equal(f.records.size, 1);
  assert.ok(first.missingInformation.includes("business.ownerEmail"));
  await assert.rejects(f.service.submitForReview(operator, { draftId: first.draftId, expectedVersion: 1 }), errorCode("INCOMPLETE_SETUP"));
  assert.equal(f.attempts(), 0);
});

test("rejects unknown fields, credentials, invalid timezone, duplicate days and unsafe booking policies", () => {
  for (const config of [
    { ...completeConfig, password: "never-store" },
    { ...completeConfig, business: { ...completeConfig.business, timezone: "invalid/zone" } },
    { ...completeConfig, businessHours: [completeConfig.businessHours[0], completeConfig.businessHours[0]] },
    { ...completeConfig, bookingPolicy: "automatically_confirm" },
    { ...completeConfig, terms: { ...completeConfig.terms, marketingEnabled: true } },
  ]) assert.equal(onboardingConfiguration.safeParse(config).success, false);
});

test("another operator cannot read, overwrite, review or provision a draft", async () => {
  const f = fixture();
  const row = await f.reviewed();
  for (const operation of [
    () => f.service.getStatus("operator-b", row.draftId),
    () => f.service.saveDraft("operator-b", { draftId: row.draftId, expectedVersion: row.version, configuration: completeConfig }),
    () => f.service.submitForReview("operator-b", { draftId: row.draftId, expectedVersion: row.version }),
    () => f.service.provisionApprovedBusiness("operator-b", { draftId: row.draftId, expectedVersion: row.version }),
  ]) await assert.rejects(operation(), errorCode("NOT_FOUND"));
});

test("only one concurrent draft update succeeds", async () => {
  const f = fixture();
  const draft = await f.service.saveDraft(operator, { draftId: randomUUID(), expectedVersion: 0, configuration: completeConfig });
  const results = await Promise.allSettled(["AI One", "AI Two"].map(receptionistName => f.service.saveDraft(operator, {
    draftId: draft.draftId, expectedVersion: draft.version, configuration: { ...completeConfig, receptionistName },
  })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});

test("Pink and Trade cannot reach review before their adapters exist", async () => {
  for (const product of ["pink", "trade"] as const) {
    const f = fixture();
    const draft = await f.service.saveDraft(operator, { draftId: randomUUID(), expectedVersion: 0, configuration: { ...completeConfig, product } });
    await assert.rejects(f.service.submitForReview(operator, { draftId: draft.draftId, expectedVersion: draft.version }), errorCode("INCOMPLETE_SETUP"));
  }
});

test("review requires an existing business mapping and fallback", async () => {
  const f = fixture();
  f.mapping.queue_id = "";
  const draft = await f.service.saveDraft(operator, { draftId: randomUUID(), expectedVersion: 0, configuration: completeConfig });
  await assert.rejects(f.service.submitForReview(operator, { draftId: draft.draftId, expectedVersion: draft.version }), errorCode("MAPPING_REQUIRED"));
});

test("only the mapped owner can review and approve the exact submitted version", async () => {
  const f = fixture();
  const review = await f.reviewed();
  await assert.rejects(f.service.getOwnerReview("another-owner", review.draftId), errorCode("NOT_FOUND"));
  await assert.rejects(f.service.approveAsOwner("another-owner", { draftId: review.draftId, expectedVersion: review.version, accepted: true }), errorCode("NOT_FOUND"));
  await assert.rejects(f.service.approveAsOwner("owner-a", { draftId: review.draftId, expectedVersion: 1, accepted: true }), errorCode("VERSION_CONFLICT"));
  await assert.rejects(f.service.provisionApprovedBusiness(operator, { draftId: review.draftId, expectedVersion: review.version }), errorCode("APPROVAL_REQUIRED"));
  const approved = await f.service.approveAsOwner("owner-a", { draftId: review.draftId, expectedVersion: review.version, accepted: true });
  assert.equal(approved.approval?.reviewedVersion, review.version);
  assert.equal(approved.approval?.termsVersion, "pilot-1");
});

test("editing an approved setup invalidates approval and blocks stale owner consent", async () => {
  const f = fixture();
  const approved = await f.approved();
  const saved = await f.service.saveDraft(operator, { draftId: approved.draftId, expectedVersion: approved.version, configuration: { ...completeConfig, receptionistName: "Changed AI" } });
  assert.equal(saved.approval, null);
  assert.equal(saved.binding, null);
  assert.equal(saved.status, "draft");
  await assert.rejects(f.service.approveAsOwner("owner-a", { draftId: approved.draftId, expectedVersion: approved.version, accepted: true }), errorCode("NOT_FOUND"));
});

test("reassigning a DID invalidates approval before any provisioning side effect", async () => {
  const f = fixture();
  const row = await f.approved();
  f.mapping.owner_id = "owner-b";
  await assert.rejects(f.service.provisionApprovedBusiness(operator, { draftId: row.draftId, expectedVersion: row.version }), errorCode("MAPPING_CHANGED"));
  assert.equal(f.attempts(), 0);
});

test("provisioning claims the draft once and repeated requests return the recorded identity", async () => {
  const f = fixture();
  const row = await f.approved();
  const results = await Promise.allSettled([1, 2].map(() => f.service.provisionApprovedBusiness(operator, { draftId: row.draftId, expectedVersion: row.version })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.attempts(), 1);
  const provisioned = await f.service.getStatus(operator, row.draftId);
  const retry = await f.service.provisionApprovedBusiness(operator, { draftId: row.draftId, expectedVersion: provisioned.version });
  assert.equal(retry.status, "provisioned");
  assert.equal(retry.liveCallsActivated, false);
  assert.equal(f.attempts(), 1);
  await assert.rejects(f.service.saveDraft(operator, { draftId: row.draftId, expectedVersion: retry.version, configuration: completeConfig }), errorCode("DRAFT_LOCKED"));
});

test("failed provisioning persists a recoverable state without leaking provider errors", async () => {
  const f = fixture();
  const row = await f.approved();
  f.setFailure(true);
  await assert.rejects(f.service.provisionApprovedBusiness(operator, { draftId: row.draftId, expectedVersion: row.version }), error =>
    error instanceof OnboardingError && error.code === "PROVISIONING_FAILED" && !error.message.includes("sensitive"));
  const failed = await f.service.getStatus(operator, row.draftId);
  assert.equal(failed.status, "provisioning_failed");
  assert.ok(failed.approval);
  f.setFailure(false);
  assert.equal((await f.service.provisionApprovedBusiness(operator, { draftId: row.draftId, expectedVersion: failed.version })).status, "provisioned");
});

test("a crashed provisioning claim can be reconciled after its lease expires", async () => {
  const f = fixture();
  const row = await f.approved();
  const record = f.records.get(row.draftId)!;
  record.status = "provisioning";
  await assert.rejects(f.service.provisionApprovedBusiness(operator, { draftId: row.draftId, expectedVersion: row.version }), errorCode("APPROVAL_REQUIRED"));
  f.advance();
  assert.equal((await f.service.provisionApprovedBusiness(operator, { draftId: row.draftId, expectedVersion: row.version })).status, "provisioned");
});

test("Black provisioner revalidates owner-approved assignment before creating an identity", async () => {
  const f = fixture();
  const provision = createAiAgentProvisioner({
    getMapping: async () => f.mapping,
    getAgent: async () => { assert.fail("Must reject before identity access"); },
    getUser: async () => { throw new Error("unused"); }, createUser: async () => { throw new Error("unused"); },
    markUser: async () => {}, createAgent: async () => {}, deleteUser: async () => {},
  });
  await assert.rejects(provision({ did: f.mapping.did, name: "AI", createdBy: operator,
    expectedAssignment: { tenantId: "tenant-a", ownerUid: "another-owner", branchId: "branch-a", queueId: "queue-a" },
  }), error => error instanceof AiAgentSetupError && error.status === 409);
});

test("MCP advertises exactly four tools, binds the operator and never exposes owner approval", async () => {
  const f = fixture();
  const server = createOnboardingMcpServer(f.service, operator);
  const client = new Client({ name: "onboarding-tests", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(tools, ["get_onboarding_status", "provision_approved_business", "save_onboarding_draft", "submit_for_owner_review"]);
    const draftId = randomUUID();
    const result = await client.callTool({ name: "save_onboarding_draft", arguments: { draftId, expectedVersion: 0, configuration: { product: "black" } } });
    assert.notEqual(result.isError, true);
    assert.equal(f.records.get(draftId)?.operator_id, operator);
    const missing = await client.callTool({ name: "get_onboarding_status", arguments: { draftId: randomUUID() } });
    assert.equal(missing.isError, true);
  } finally { await client.close(); await server.close(); }
});

test("HTTP feature gates and authentication protect admin, owner and MCP endpoints", async () => {
  const previousFlag = process.env.AI_ONBOARDING_ENABLED;
  const f = fixture();
  const routers = createOnboardingRouters({ service: f.service });
  const app = express();
  app.use(express.json());
  app.use("/admin", routers.adminRoutes); app.use("/owner", routers.ownerRoutes); app.use("/mcp", routers.mcpRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    process.env.AI_ONBOARDING_ENABLED = "false";
    assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 404);
    process.env.AI_ONBOARDING_ENABLED = "true";
    assert.equal((await fetch(`${base}/admin/${randomUUID()}`)).status, 401);
    assert.equal((await fetch(`${base}/owner/${randomUUID()}/review`)).status, 401);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: { "x-setup-secret": "not-a-user" } })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousFlag === undefined) delete process.env.AI_ONBOARDING_ENABLED; else process.env.AI_ONBOARDING_ENABLED = previousFlag;
  }
});

test("the stateless HTTP MCP endpoint supports SDK initialization and authenticated tool calls", async () => {
  const previousFlag = process.env.AI_ONBOARDING_ENABLED;
  process.env.AI_ONBOARDING_ENABLED = "true";
  const f = fixture();
  let authenticatedRequests = 0;
  const authenticate: RequestHandler = (_req, res, next) => {
    authenticatedRequests++;
    res.locals.supabaseAuth = { user: { id: operator }, roles: ["super_admin"] };
    next();
  };
  const routers = createOnboardingRouters({ service: f.service, authenticateOperator: authenticate });
  const app = express(); app.use(express.json()); app.use("/mcp", routers.mcpRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const client = new Client({ name: "http-onboarding-tests", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 4);
    const draftId = randomUUID();
    const result = await client.callTool({ name: "save_onboarding_draft", arguments: { draftId, expectedVersion: 0, configuration: { product: "black" } } });
    assert.notEqual(result.isError, true);
    assert.equal(f.records.get(draftId)?.operator_id, operator);
    assert.ok(authenticatedRequests >= 3);
    assert.equal(transport.sessionId, undefined);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousFlag === undefined) delete process.env.AI_ONBOARDING_ENABLED; else process.env.AI_ONBOARDING_ENABLED = previousFlag;
  }
});

test("owner HTTP approval requires explicit acceptance and uses the authenticated UID", async () => {
  const previousFlag = process.env.AI_ONBOARDING_ENABLED;
  process.env.AI_ONBOARDING_ENABLED = "true";
  const f = fixture();
  const row = await f.reviewed();
  const ownerAuth: RequestHandler = (_req, res, next) => { res.locals.blackOwnerUid = "owner-a"; next(); };
  const routers = createOnboardingRouters({ service: f.service, authenticateOwner: ownerAuth });
  const app = express(); app.use(express.json()); app.use("/owner", routers.ownerRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/owner/${row.draftId}`;
  try {
    const review = await fetch(`${base}/review`); assert.equal(review.status, 200);
    const withoutAcceptance = await fetch(`${base}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: row.version }) });
    assert.equal(withoutAcceptance.status, 400);
    const response = await fetch(`${base}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: row.version, accepted: true }) });
    assert.equal(response.status, 200);
    const result = await response.json() as { approval: { ownerUid: string } };
    assert.equal(result.approval.ownerUid, "owner-a");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousFlag === undefined) delete process.env.AI_ONBOARDING_ENABLED; else process.env.AI_ONBOARDING_ENABLED = previousFlag;
  }
});

test("voice onboarding saves successive spoken sections into one call-bound draft", async () => {
  const f = fixture();
  let authorizations = 0;
  const options = { service: f.service, operatorId: operator, sessionId: "live-onboarding-call-a", terms: completeConfig.terms,
    authorizeOperator: async () => { authorizations++; }, isEnabled: () => true };
  const call = await createLiveOnboardingTools(options);
  await call.execute("save_onboarding_draft", { configuration: { product: "black", business: { tradingName: "Spoken Workshop" } } });
  await call.execute("save_onboarding_draft", { configuration: { business: { ownerName: "Caller Owner", ownerEmail: "caller@example.test" } } });
  const saved = await f.service.getStatus(operator, call.draftId);
  assert.equal(saved.configuration.business?.tradingName, "Spoken Workshop");
  assert.equal(saved.configuration.business?.ownerName, "Caller Owner");
  assert.deepEqual(saved.configuration.terms, completeConfig.terms);
  const reattached = await createLiveOnboardingTools(options);
  assert.equal(reattached.draftId, call.draftId);
  assert.equal(reattached.initialStatus.configuration.business?.tradingName, "Spoken Workshop");
  assert.equal(f.records.size, 1);
  assert.ok(authorizations >= 4);
});

test("voice tools cannot choose another call draft, supply approval or change published terms", async () => {
  const f = fixture();
  const call = await createLiveOnboardingTools({ service: f.service, operatorId: operator, sessionId: "call-a", terms: completeConfig.terms,
    authorizeOperator: async () => {}, isEnabled: () => true });
  assert.notEqual(onboardingDraftIdForCall("call-a"), onboardingDraftIdForCall("call-b"));
  await assert.rejects(call.execute("get_onboarding_status", { draftId: onboardingDraftIdForCall("call-b") }));
  await assert.rejects(call.execute("save_onboarding_draft", { configuration: { terms: { ...completeConfig.terms, billingSummary: "Free forever" } } }));
  await assert.rejects(call.execute("save_onboarding_draft", { configuration: { ownerApproved: true } }));
  await assert.rejects(call.execute("approve_as_owner", {}), errorCode("TOOL_NOT_ALLOWED"));
  await assert.rejects(call.execute("create_booking", {}), errorCode("TOOL_NOT_ALLOWED"));
  assert.deepEqual(call.tools.map(tool => tool.name).sort(), ["get_onboarding_status", "provision_approved_business", "save_onboarding_draft", "submit_for_owner_review"]);
  const saveSchema = call.tools.find(tool => tool.name === "save_onboarding_draft")!.parameters;
  assert.equal(JSON.stringify(saveSchema).includes('"draftId"'), false);
  assert.equal(JSON.stringify(saveSchema).includes('"terms"'), false);
});

test("a call reads back and submits details, waits for verified owner approval, then provisions", async () => {
  const f = fixture();
  const call = await createLiveOnboardingTools({ service: f.service, operatorId: operator, sessionId: "call-full-onboarding", terms: completeConfig.terms,
    authorizeOperator: async () => {}, isEnabled: () => true });
  const { terms: _terms, ...spokenConfiguration } = completeConfig;
  await call.execute("save_onboarding_draft", { configuration: spokenConfiguration });
  await assert.rejects(call.execute("submit_for_owner_review", { callerConfirmedDetails: false }));
  const review = await call.execute("submit_for_owner_review", { callerConfirmedDetails: true });
  assert.equal(review.status, "owner_review");
  assert.equal(review.ownerApproved, false);
  await assert.rejects(call.execute("provision_approved_business", { callerConfirmedProvisioning: true }), errorCode("APPROVAL_REQUIRED"));
  const row = await f.service.getStatus(operator, call.draftId);
  await f.service.approveAsOwner("owner-a", { draftId: row.draftId, expectedVersion: row.version, accepted: true });
  const approved = await call.execute("get_onboarding_status", {});
  assert.equal(approved.ownerApproved, true);
  assert.equal("approval" in approved, false);
  await call.execute("save_onboarding_draft", { configuration: spokenConfiguration });
  assert.equal((await call.execute("get_onboarding_status", {})).ownerApproved, true);
  const provisioned = await call.execute("provision_approved_business", { callerConfirmedProvisioning: true });
  assert.equal(provisioned.identityProvisioned, true);
  assert.equal(provisioned.liveCallsActivated, false);
  assert.equal(f.attempts(), 1);
});

test("concurrent voice saves preserve collected facts and a feature pause prevents later writes", async () => {
  const f = fixture();
  let enabled = true;
  const call = await createLiveOnboardingTools({ service: f.service, operatorId: operator, sessionId: "call-concurrent", terms: completeConfig.terms,
    authorizeOperator: async () => {}, isEnabled: () => enabled });
  await Promise.all([
    call.execute("save_onboarding_draft", { configuration: { business: { tradingName: "Workshop" } } }),
    call.execute("save_onboarding_draft", { configuration: { business: { ownerName: "Owner" } } }),
  ]);
  const saved = await f.service.getStatus(operator, call.draftId);
  assert.equal(saved.configuration.business?.tradingName, "Workshop");
  assert.equal(saved.configuration.business?.ownerName, "Owner");
  enabled = false;
  await assert.rejects(call.execute("save_onboarding_draft", { configuration: { receptionistName: "Paused" } }), errorCode("ONBOARDING_DISABLED"));
  assert.equal((await f.service.getStatus(operator, call.draftId)).version, saved.version);
});

test("voice startup fails before draft creation when operator authorization or published terms are unavailable", async () => {
  const f = fixture();
  const options = { service: f.service, operatorId: operator, sessionId: "unauthorized-call", terms: completeConfig.terms,
    authorizeOperator: async () => { throw new OnboardingError(403, "OPERATOR_UNAVAILABLE", "Unavailable"); }, isEnabled: () => true };
  await assert.rejects(createLiveOnboardingTools(options), errorCode("OPERATOR_UNAVAILABLE"));
  await assert.rejects(createLiveOnboardingTools({ ...options, terms: undefined }));
  assert.equal(f.records.size, 0);
});

test("voice mode defaults to receptionist and cannot silently accept an unknown mode", () => {
  const previous = process.env.AI_LIVE_AGENT_MODE;
  try {
    delete process.env.AI_LIVE_AGENT_MODE;
    assert.equal(liveAgentMode(), "receptionist");
    process.env.AI_LIVE_AGENT_MODE = "onboarding";
    assert.equal(liveAgentMode(), "onboarding");
    process.env.AI_LIVE_AGENT_MODE = "unknown";
    assert.throws(() => liveAgentMode(), errorCode("INVALID_AGENT_MODE"));
  } finally { if (previous === undefined) delete process.env.AI_LIVE_AGENT_MODE; else process.env.AI_LIVE_AGENT_MODE = previous; }
});

test("a signed incoming onboarding call advertises its tools and saves spoken facts through the real sideband handler", async () => {
  const f = fixture();
  const environment: Record<string, string> = {
    AI_LIVE_SIP_ENABLED: "true", AI_LIVE_AGENT_MODE: "onboarding", AI_ONBOARDING_ENABLED: "true",
    AI_ONBOARDING_OPERATOR_ID: "e9681eb8-0717-4c51-9f47-e6bc917fc9b1",
    AI_ONBOARDING_APPROVED_TERMS_JSON: JSON.stringify(completeConfig.terms),
    AI_LIVE_TEST_DID: "+61400999999", OPENAI_API_KEY: "test-only-never-sent-to-openai",
    OPENAI_PROJECT_ID: "test-project", OPENAI_WEBHOOK_SECRET: "test-webhook-secret",
  };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
  const provider = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(resolve => provider.once("listening", resolve));
  const providerAddress = provider.address(); assert.ok(providerAddress && typeof providerAddress !== "string");
  const connected = new Promise<WebSocket>(resolve => provider.once("connection", resolve));
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const router = createOpenAiLiveRouter({
    request: async (path, init) => {
      requests.push({ path, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    },
    createOnboarding: options => createLiveOnboardingTools({ ...options, service: f.service, operatorId: operator, authorizeOperator: async () => {} }),
    connectSocket: () => new WebSocket(`ws://127.0.0.1:${providerAddress.port}`),
  });
  const app = express(); app.use(express.raw({ type: "application/json" })); app.use("/live", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const sessionId = "live-signed-onboarding-session";
  const body = JSON.stringify({ type: "live.transport.incoming", data: { type: "sip", session_id: sessionId,
    sip_headers: [{ name: "From", value: "sip:unverified-owner@untrusted.example" }] } });
  function webhook(id: string, valid = true) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", environment.OPENAI_WEBHOOK_SECRET!).update(`${id}.${timestamp}.${body}`).digest("base64");
    return fetch(`http://127.0.0.1:${address.port}/live/webhook`, { method: "POST", body, headers: {
      "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${valid ? signature : "invalid"}`,
    } });
  }
  function runTool(socket: WebSocket, callId: string, name: string, args: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off("message", receive); reject(new Error("Timed out waiting for local sideband tool result")); }, 3000);
      function receive(data: WebSocket.RawData) {
        const message = JSON.parse(data.toString());
        if (message.type === "response.item.create" && message.item.call_id === callId) {
          clearTimeout(timeout); socket.off("message", receive); resolve(JSON.parse(message.item.output));
        }
      }
      socket.on("message", receive);
      socket.send(JSON.stringify({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) } } }));
    });
  }
  try {
    assert.equal((await webhook("invalid-signature", false)).status, 401);
    assert.equal(f.records.size, 0);
    const responses = await Promise.all([webhook("valid-delivery-one"), webhook("valid-delivery-two")]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.equal(requests.filter(request => request.path.endsWith("/accept")).length, 1);
    assert.equal(f.records.size, 1);
    const session = requests[0]!.body.session as { instructions: string; delegation: { responses: { tools: Array<{ name: string }> } } };
    assert.match(session.instructions, /BMS Pro's AI onboarding assistant/);
    assert.equal(session.delegation.responses.tools.some(tool => tool.name === "save_onboarding_draft"), true);
    assert.equal(session.delegation.responses.tools.some(tool => tool.name === "get_workshop_profile"), false);
    const socket = await connected;
    socket.send(JSON.stringify({ type: "response.function_call_arguments.done", call_id: "premature", name: "save_onboarding_draft", arguments: JSON.stringify({ configuration: { business: { tradingName: "Must not be saved" } } }) }));
    const initial = await runTool(socket, "read-initial", "get_onboarding_status", {});
    assert.equal((initial.configuration as Record<string, unknown>).business, undefined);
    const saved = await runTool(socket, "save-spoken-details", "save_onboarding_draft", { configuration: { business: { tradingName: "Workshop from call" } } });
    assert.equal(((saved.configuration as Record<string, unknown>).business as Record<string, unknown>).tradingName, "Workshop from call");
    socket.send(JSON.stringify({ type: "response.output_item.done", item: { type: "function_call", call_id: "save-spoken-details", name: "save_onboarding_draft", arguments: JSON.stringify({ configuration: { business: { tradingName: "Duplicate must be ignored" } } }) } }));
    const afterDuplicate = await runTool(socket, "read-after-duplicate", "get_onboarding_status", {});
    assert.equal(((afterDuplicate.configuration as Record<string, unknown>).business as Record<string, unknown>).tradingName, "Workshop from call");
    assert.equal((await f.service.getStatus(operator, onboardingDraftIdForCall(sessionId))).version, 2);
    const unauthorized = await runTool(socket, "unauthorized-booking", "create_booking", {});
    assert.ok(unauthorized.error);
    assert.equal(f.attempts(), 0);
    socket.send(JSON.stringify({ type: "session.closed" }));
  } finally {
    for (const client of provider.clients) client.terminate();
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("bridge MCP scopes drafts by approved DID and call ID and rejects workshop numbers", async () => {
  const f = fixture();
  const operatorId = "e9681eb8-0717-4c51-9f47-e6bc917fc9b1";
  const did = "0359111499";
  const secret = "onboarding-only-test-credential-0000000000000000";
  const settings: Record<string, string> = {
    AI_ONBOARDING_ENABLED: "true", AI_ONBOARDING_BRIDGE_SECRET: secret,
    AI_VOICE_BRIDGE_SECRET: "different-workshop-only-test-credential-00000000",
    AI_ONBOARDING_DIDS_JSON: JSON.stringify([did, "0359111400"]),
    AI_ONBOARDING_OPERATOR_ID: operatorId, AI_ONBOARDING_APPROVED_TERMS_JSON: JSON.stringify(completeConfig.terms),
  };
  const previous = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(settings)) process.env[key] = value;
  let authorized = true;
  const router = createOnboardingCallRouter({ service: f.service,
    authorizeOperator: async actor => { assert.equal(actor, operatorId); if (!authorized) throw new OnboardingError(403, "OPERATOR_UNAVAILABLE", "Operator unavailable"); },
    getMapping: async number => number === "0359111400" ? f.mapping : null,
  });
  const app = express(); app.use(express.json()); app.use("/mcp", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const clients: Client[] = [];
  async function connect(callId: string) {
    const client = new Client({ name: "bridge-test", version: "1.0.0" }); clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: {
      Authorization: `Bearer ${secret}`, "X-BMSPro-DID": did, "X-BMSPro-Onboarding-Call": callId,
    } } }));
    return client;
  }
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    for (const [number, expected] of [["0359111400", 409], ["0359111403", 403]] as const) {
      assert.equal((await fetch(url, { method: "POST", headers: {
        Authorization: `Bearer ${secret}`, "X-BMSPro-DID": number, "X-BMSPro-Onboarding-Call": randomUUID(),
      } })).status, expected);
    }
    assert.equal(f.records.size, 0);
    const first = await connect(randomUUID());
    const second = await connect(randomUUID());
    assert.equal(f.records.size, 2);
    assert.deepEqual(new Set([...f.records.values()].map(row => row.operator_id)), new Set([operatorId]));
    const resource = await first.readResource({ uri: "bmspro://onboarding/call" });
    const profile = JSON.parse(String(resource.contents[0]!.text));
    assert.equal(profile.did, did);
    assert.equal(profile.mode, "onboarding");
    const saved = await first.callTool({ name: "save_onboarding_draft", arguments: { configuration: { business: { tradingName: "Call One" } } } });
    assert.notEqual(saved.isError, true);
    const other = await second.callTool({ name: "get_onboarding_status", arguments: {} });
    const otherStatus = JSON.parse(String((other.content as Array<{ text: string }>)[0]!.text));
    assert.equal(otherStatus.configuration.business, undefined);
    const hijack = await first.callTool({ name: "get_onboarding_status", arguments: { draftId: otherStatus.reference } });
    assert.equal(hijack.isError, true);
    authorized = false;
    await assert.rejects(first.callTool({ name: "save_onboarding_draft", arguments: { configuration: { business: { tradingName: "Revoked" } } } }));
    assert.equal([...f.records.values()].some(row => row.configuration.business?.tradingName === "Revoked"), false);
  } finally {
    for (const client of clients) await client.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
