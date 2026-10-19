import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import WebSocket from "ws";
import { z } from "zod";

import { getDidMappingByDid } from "../../services/did-mappings.service.js";
import { blackFrontOfficeAdapter } from "../../services/ai/black-front-office.adapter.js";
import { createFrontOfficeBookingTools } from "../../services/ai/front-office-booking.service.js";
import type { FrontOfficeTenantContext } from "../../services/ai/brand-adapter.js";
import { createLiveOnboardingTools, liveAgentMode, type LiveOnboardingTools } from "../../services/ai/live-onboarding.service.js";
import { onboardingService, assertVoiceOnboardingOperator } from "../../services/ai/onboarding.repository.js";
import { OnboardingError } from "../../services/ai/onboarding.service.js";

type JsonObject = Record<string, unknown>;
type RawRequest = Request & { rawBody?: Buffer };
type LiveCall = {
  did: string;
  staffSipUri: string | null;
  allowedTools: Set<string>;
  socket: WebSocket | null;
  handledCalls: Set<string>;
} & ({
  mode: "receptionist";
  context: FrontOfficeTenantContext;
  bookingTools: ReturnType<typeof createFrontOfficeBookingTools>;
} | { mode: "onboarding"; onboardingTools: LiveOnboardingTools });

export function createOpenAiLiveRouter(options: {
  request?: (path: string, init: RequestInit) => Promise<globalThis.Response>;
  createOnboarding?: typeof createLiveOnboardingTools;
  connectSocket?: (url: string, options: WebSocket.ClientOptions) => WebSocket;
} = {}) {
  const router = Router();
  const activeCalls = new Map<string, LiveCall>();
  const completedWebhookIds = new Map<string, number>();
  const inFlightWebhookIds = new Map<string, Promise<void>>();
  const inFlightSessionIds = new Map<string, Promise<void>>();
  const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
  const WEBHOOK_CACHE_LIMIT = 10_000;
  const OPENAI_API_BASE = "https://api.openai.com/v1";

  function record(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonObject
      : {};
  }

  function liveEnabled(): boolean {
    return process.env.AI_LIVE_SIP_ENABLED === "true";
  }

  function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
  }

  function verifyOpenAiWebhook(req: RawRequest): boolean {
    const secret = process.env.OPENAI_WEBHOOK_SECRET?.trim();
    const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : undefined);
    const webhookId = req.header("webhook-id")?.trim();
    const timestamp = req.header("webhook-timestamp")?.trim();
    const signatureHeader = req.header("webhook-signature")?.trim();
    if (!secret || !rawBody || !webhookId || !timestamp || !signatureHeader) return false;

    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS) return false;

    const keyText = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    let key: Buffer;
    try {
      key = secret.startsWith("whsec_") ? Buffer.from(keyText, "base64") : Buffer.from(secret);
    } catch {
      return false;
    }
    const signedContent = `${webhookId}.${timestamp}.${rawBody.toString("utf8")}`;
    const expected = createHmac("sha256", key).update(signedContent).digest("base64");
    const signatures = signatureHeader.split(/\s+/).flatMap((part) => {
      const [version, value] = part.split(",", 2);
      return version === "v1" && value ? [value] : [];
    });
    return signatures.some((value) => {
      const actualBytes = Buffer.from(value);
      const expectedBytes = Buffer.from(expected);
      return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
    });
  }

  function rawWebhookBody(req: RawRequest): Buffer | undefined {
    return req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : undefined);
  }

  async function tenantForDid(did: string): Promise<FrontOfficeTenantContext | null> {
    if (!did) return null;
    const mapping = await getDidMappingByDid(did);
    if (!mapping?.tenant_id || !mapping.owner_id || !mapping.branch_id) return null;
    return {
      did: mapping.did,
      tenantId: mapping.tenant_id,
      ownerId: mapping.owner_id,
      branchId: mapping.branch_id,
      branchName: mapping.branch_name,
      workshopName: mapping.workshop_name,
    };
  }

  const toolDefinitions: JsonObject[] = [
    { type: "function", name: "get_workshop_profile", description: "Get the workshop and branch assigned to this incoming phone number, including business hours and timezone.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true },
    { type: "function", name: "list_services", description: "List the services and published service details for the assigned workshop branch. Do not invent services, prices, or durations.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true },
    { type: "function", name: "get_available_slots", description: "Get available drop-off times for selected services on a date in the workshop timezone. These do not reserve a mechanic or an exclusive time slot.", parameters: { type: "object", properties: { date: { type: "string", description: "Calendar date YYYY-MM-DD in the workshop timezone." }, serviceIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 } }, required: ["date", "serviceIds"], additionalProperties: false }, strict: true },
  ];

  if (process.env.AI_MCP_BOOKINGS_ENABLED === "true") {
    toolDefinitions.push({
      type: "function", name: "create_booking",
      description: "Submit a drop-off booking request for staff approval. Only call after reading back the service, branch, local date/time, and customer details and receiving explicit confirmation. Never describe a pending request as confirmed.",
      parameters: {
        type: "object",
        properties: {
          slotToken: { type: "string" }, customerConfirmed: { type: "boolean", enum: [true] },
          customerName: { type: "string" }, customerEmail: { type: "string" }, customerPhone: { type: "string" },
          vehicleNumber: { type: "string" }, vehicleType: { type: "string", enum: ["small_car", "sedan_wagon", "suv", "ute_van_4wd", "performance_large"] }, notes: { type: "string" },
        },
        required: ["slotToken", "customerConfirmed", "customerName", "customerEmail", "customerPhone"],
        additionalProperties: false,
      }, strict: false,
    });
  }

  if (process.env.AI_LIVE_STAFF_SIP_URI?.trim()) {
    toolDefinitions.push({
      type: "function", name: "transfer_to_staff",
      description: "Transfer the caller to the configured workshop staff destination when they ask for a person or the request needs staff. Only claim transfer after this tool succeeds.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true,
    });
  }

  function sessionInstructions(context: FrontOfficeTenantContext): string {
    return [
      `You are the phone receptionist for ${context.workshopName || "this workshop"}, ${context.branchName || "the assigned branch"}.`,
      "Speak naturally and briefly. Ask one question at a time. Listen to the caller and do not claim you heard details that were unclear.",
      "Use backend tools for workshop details, services, availability, and booking requests. Never invent business information.",
      "Black accepts drop-off requests based on opening hours and a daily limit; staff must approve them. A requested drop-off time is not an exclusive mechanic appointment.",
      "Get explicit caller confirmation before submitting a booking request. State only that it is submitted for staff approval when the backend returns PENDING_REVIEW.",
      "If a tool fails, do not claim success. Use transfer_to_staff when it is available; otherwise offer staff follow-up without claiming that a transfer occurred.",
    ].join(" ");
  }

  function responseToolsPrompt(): string {
    return "Execute only the registered workshop tools. The called DID is mapped by the server to one workshop and branch. Never select or switch a tenant, owner, branch, or service outside those tool results. Booking writes follow the workshop's staff-approval workflow.";
  }

  async function openAiRequest(path: string, init: RequestInit): Promise<globalThis.Response> {
    if (options.request) return options.request(path, init);
    const apiKey = requiredEnv("OPENAI_API_KEY");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Content-Type", "application/json");
    const projectId = process.env.OPENAI_PROJECT_ID?.trim();
    if (projectId) headers.set("OpenAI-Project", projectId);
    return fetch(`${OPENAI_API_BASE}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  }

  async function rejectCall(sessionId: string, statusCode: number): Promise<void> {
    const response = await openAiRequest(`/live/sessions/${encodeURIComponent(sessionId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ status_code: statusCode }),
    });
    if (!response.ok) throw new Error(`OpenAI rejected-call request returned HTTP ${response.status}.`);
  }

  async function executeTool(sessionId: string, call: LiveCall, name: string, rawArguments: string): Promise<string> {
    if (!call.allowedTools.has(name)) throw new Error("This tool is not enabled for this call.");
    const args = JSON.parse(rawArguments) as unknown;
    if (name === "transfer_to_staff") {
      const targetUri = call.staffSipUri;
      if (!targetUri) throw new Error("No staff destination is configured for this call.");
      const response = await openAiRequest(`/live/sessions/${encodeURIComponent(sessionId)}/refer`, {
        method: "POST",
        body: JSON.stringify({ target_uri: targetUri }),
      });
      if (!response.ok) throw new Error(`OpenAI transfer returned HTTP ${response.status}.`);
      return JSON.stringify({ status: "TRANSFERRED", message: "The caller was transferred to staff." });
    }
    if (call.mode === "onboarding") return JSON.stringify(await call.onboardingTools.execute(name, args));
    const context = call.context;
    if (name === "get_workshop_profile") {
      const branch = await blackFrontOfficeAdapter.getBranch(context);
      return JSON.stringify({ brand: "black", workshopName: context.workshopName, branchName: context.branchName, branch });
    }
    if (name === "list_services") {
      const services = await blackFrontOfficeAdapter.listServices(context);
      return JSON.stringify({ brand: "black", workshopName: context.workshopName, branchName: context.branchName, services });
    }
    if (name === "get_available_slots") return JSON.stringify(await call.bookingTools.getAvailableSlots(args));
    if (name === "create_booking") return JSON.stringify(await call.bookingTools.createBooking(args));
    throw new Error("Unsupported Live function tool.");
  }

  function sendSocketEvent(socket: WebSocket, event: JsonObject): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  async function handleFunctionCall(sessionId: string, callId: string, name: string, args: string): Promise<void> {
    const call = activeCalls.get(sessionId);
    if (!call?.socket || call.handledCalls.has(callId)) return;
    const socket = call.socket;
    call.handledCalls.add(callId);
    let output: string;
    try {
      output = await executeTool(sessionId, call, name, args);
    } catch (error) {
      console.error(`[ai live] Tool ${name} failed: ${error instanceof OnboardingError ? error.code : "TOOL_FAILED"}`);
      output = JSON.stringify(error instanceof OnboardingError
        ? { error: error.message, code: error.code }
        : error instanceof z.ZodError
          ? { error: "Some collected fields are invalid. Ask the caller to clarify them.", issues: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) }
          : { error: "The requested information or action could not be verified. Offer staff follow-up without claiming success." });
    }
    if (activeCalls.get(sessionId) !== call || call.socket !== socket) return;
    sendSocketEvent(socket, {
      type: "response.item.create",
      event_id: randomUUID(),
      item: { type: "function_call_output", call_id: callId, output },
    });
    sendSocketEvent(socket, { type: "response.create", event_id: randomUUID() });
  }

  function connectSideband(sessionId: string, call: LiveCall): void {
    const apiKey = requiredEnv("OPENAI_API_KEY");
    const socketUrl = `${OPENAI_API_BASE.replace(/^https:/, "wss:")}/live/sessions/${encodeURIComponent(sessionId)}/attach`;
    const socketOptions = { headers: { Authorization: `Bearer ${apiKey}` } };
    const socket = options.connectSocket?.(socketUrl, socketOptions) ?? new WebSocket(socketUrl, socketOptions);
    call.socket = socket;
    socket.on("message", (data) => {
      let outer: JsonObject;
      try { outer = record(JSON.parse(data.toString())); } catch { return; }
      const inner = record(outer.event);
      const event = Object.keys(inner).length ? inner : outer;
      const item = record(event.item);
      if (event.type === "response.output_item.done" && item.type === "function_call") {
        const toolCallId = typeof item.call_id === "string" ? item.call_id : "";
        const name = typeof item.name === "string" ? item.name : "";
        const args = typeof item.arguments === "string" ? item.arguments : "{}";
        if (toolCallId && name) void handleFunctionCall(sessionId, toolCallId, name, args);
      }
      // Execute completed function items only. Arguments-done alone is not a
      // completed tool call and must not trigger an onboarding write.
      if (event.type === "session.closed") {
        socket.close();
        activeCalls.delete(sessionId);
      }
    });
    socket.on("error", (error) => {
      console.error(`[ai live] Sideband connection failed for session ${sessionId}: ${error.message}`);
    });
    socket.on("close", () => {
      const active = activeCalls.get(sessionId);
      if (active?.socket === socket) active.socket = null;
      activeCalls.delete(sessionId);
    });
  }

  async function acceptCall(sessionId: string, did: string, context: FrontOfficeTenantContext | null): Promise<void> {
    const mode = liveAgentMode();
    let call: LiveCall;
    let definitions: JsonObject[];
    let instructions: string;
    let backendInstructions: string;
    const base = { did, socket: null, handledCalls: new Set<string>(), allowedTools: new Set<string>() };
    if (mode === "onboarding") {
      const operatorId = z.string().uuid().parse(requiredEnv("AI_ONBOARDING_OPERATOR_ID"));
      let terms: unknown;
      try { terms = JSON.parse(requiredEnv("AI_ONBOARDING_APPROVED_TERMS_JSON")); }
      catch { throw new OnboardingError(503, "TERMS_UNAVAILABLE", "Published onboarding terms are not configured correctly."); }
      const onboardingTools = await (options.createOnboarding ?? createLiveOnboardingTools)({
        service: onboardingService, sessionId, operatorId, terms,
        authorizeOperator: () => assertVoiceOnboardingOperator(operatorId),
        isEnabled: () => liveEnabled() && process.env.AI_ONBOARDING_ENABLED === "true" && liveAgentMode() === "onboarding",
      });
      definitions = [...onboardingTools.tools];
      const staffSipUri = process.env.AI_ONBOARDING_STAFF_SIP_URI?.trim() || null;
      if (staffSipUri) definitions.push({
        type: "function", name: "transfer_to_staff", description: "Transfer this onboarding caller to the configured BMS Pro platform team. Claim transfer only after success.",
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true,
      });
      call = { ...base, mode, onboardingTools, staffSipUri };
      instructions = onboardingTools.instructions;
      backendInstructions = onboardingTools.backendInstructions;
    } else {
      if (!context) throw new Error("A mapped workshop is required for receptionist calls.");
      call = { ...base, mode, context, staffSipUri: process.env.AI_LIVE_STAFF_SIP_URI?.trim() || null,
        bookingTools: createFrontOfficeBookingTools(blackFrontOfficeAdapter, async () => context) };
      definitions = toolDefinitions;
      instructions = sessionInstructions(context);
      backendInstructions = responseToolsPrompt();
    }
    call.allowedTools = new Set(definitions.map(tool => String(tool.name)));
    const response = await openAiRequest(`/live/sessions/${encodeURIComponent(sessionId)}/accept`, {
      method: "POST",
      body: JSON.stringify({
        session: {
          type: "live",
          model: process.env.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1",
          instructions,
          audio: { output: { voice: process.env.OPENAI_LIVE_VOICE?.trim() || "marin" } },
          delegation: {
            type: "responses",
            responses: {
              model: process.env.OPENAI_LIVE_BACKEND_MODEL?.trim() || "gpt-6-luna",
              instructions: backendInstructions,
              tools: definitions,
              tool_choice: "auto",
              parallel_tool_calls: false,
            },
          },
          store: false,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI Live accept returned HTTP ${response.status}.`);
    }
    activeCalls.set(sessionId, call);
    connectSideband(sessionId, call);
  }

  function cleanWebhookCache(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, createdAt] of completedWebhookIds) if (createdAt < cutoff) completedWebhookIds.delete(id);
    while (completedWebhookIds.size > WEBHOOK_CACHE_LIMIT) {
      const oldest = completedWebhookIds.keys().next().value;
      if (!oldest) break;
      completedWebhookIds.delete(oldest);
    }
  }

  router.post("/webhook", async (req: RawRequest, res: Response) => {
    if (!liveEnabled()) {
      res.status(404).json({ error: "GPT-Live SIP is disabled." });
      return;
    }
    if (!verifyOpenAiWebhook(req)) {
      res.status(401).json({ error: "Invalid OpenAI webhook signature." });
      return;
    }

    const rawBody = rawWebhookBody(req);
    let event: JsonObject;
    try { event = record(JSON.parse(rawBody!.toString("utf8"))); }
    catch { res.status(400).json({ error: "Invalid webhook JSON." }); return; }
    if (event.type !== "live.transport.incoming") {
      res.status(200).json({ received: true });
      return;
    }

    const webhookId = req.header("webhook-id")!.trim();
    cleanWebhookCache();
    if (completedWebhookIds.has(webhookId)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    const existing = inFlightWebhookIds.get(webhookId);
    if (existing) {
      try {
        await existing;
        res.status(200).json({ received: true, duplicate: true });
      } catch {
        res.status(503).json({ error: "Incoming call setup failed." });
      }
      return;
    }
    const processing = (async () => {
      requiredEnv("OPENAI_API_KEY");
      requiredEnv("OPENAI_WEBHOOK_SECRET");
      requiredEnv("OPENAI_PROJECT_ID");
      const data = record(event.data);
      if (data.type !== "sip") throw new Error("Incoming Live event is not a SIP call.");
      const sessionId = typeof data.session_id === "string" ? data.session_id.trim() : "";
      if (!sessionId) throw new Error("Incoming SIP webhook is missing session_id.");
      if (activeCalls.has(sessionId)) return;
      const pendingSession = inFlightSessionIds.get(sessionId);
      if (pendingSession) { await pendingSession; return; }
      // This pilot is intentionally restricted to one server-configured DID.
      // Do not authorize a tenant based on caller-controlled SIP header values.
      const setup = (async () => {
        const did = requiredEnv("AI_LIVE_TEST_DID");
        const mode = liveAgentMode();
        const context = mode === "receptionist" ? await tenantForDid(did) : null;
        if (mode === "receptionist" && !context) {
          await rejectCall(sessionId, 480);
        } else {
          await acceptCall(sessionId, did, context);
        }
      })();
      inFlightSessionIds.set(sessionId, setup);
      try { await setup; } finally { inFlightSessionIds.delete(sessionId); }
    })();
    inFlightWebhookIds.set(webhookId, processing);
    try {
      await processing;
      completedWebhookIds.set(webhookId, Date.now());
      res.status(200).json({ received: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[ai live] Incoming call setup failed: ${message}`);
      res.status(503).json({ error: "Incoming call setup failed." });
    } finally {
      inFlightWebhookIds.delete(webhookId);
    }
  });

  return router;
}

export default createOpenAiLiveRouter();
