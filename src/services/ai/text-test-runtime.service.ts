import { randomUUID, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getDidMappingByDid, listDidMappings } from "../did-mappings.service.js";
import { resolveVoiceProductForDid } from "./voice-route.service.js";
import { localCalendar } from "./front-office-booking.service.js";

export type TextTestMode = "receptionist" | "onboarding";
export type TextTestBrand = "black" | "trade" | "pink";
export type TextFunctionTool = { type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: false };
export type TextTestRuntime = {
  label: string; mode: TextTestMode; did: string; brand: TextTestBrand | null;
  instructions: string; tools: TextFunctionTool[];
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
};
export class TextRuntimeError extends Error {
  constructor(public status: number, public stage: string, public httpStatus: number | undefined, message: string) { super(message); }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const writes = new Set(["create_booking", "create_inspection_request", "complete_business_onboarding"]);
const receptionistTools = new Set(["get_workshop_profile", "get_business_profile", "list_services", "get_available_slots", "create_booking", "create_inspection_request"]);
const onboardingTools = new Set(["get_onboarding_status", "save_onboarding_draft", "complete_business_onboarding", "get_available_black_subscription_plans", "get_available_trade_subscription_plans", "get_available_pink_subscription_plans"]);

function configuredOnboardingDids(): string[] {
  try {
    const parsed: unknown = JSON.parse(process.env.AI_ONBOARDING_DIDS_JSON ?? "[]");
    if (!Array.isArray(parsed) || parsed.some(did => typeof did !== "string" || !/^\d{6,15}$/.test(did))) throw new Error("Invalid DID list.");
    return parsed;
  } catch { throw new TextRuntimeError(503, "configuration", undefined, "The backend onboarding DID list is invalid. Check AI_ONBOARDING_DIDS_JSON."); }
}

export async function textTestOptions() {
  const rows = await listDidMappings({});
  const receptionist = (await Promise.all(rows.map(async mapping => {
    try {
      const did = mapping.did.replace(/^\+/, "");
      const route = await resolveVoiceProductForDid(did);
      return { did, brand: route.brand, name: mapping.workshop_name || "Mapped business", branch: mapping.branch_name || "" };
    } catch { return null; }
  }))).filter(row => row !== null);
  return { receptionist, onboarding: process.env.AI_ONBOARDING_ENABLED === "true" ? configuredOnboardingDids() : [], realActions: true };
}

function decode(result: unknown): unknown {
  const body = record(result);
  const text = Array.isArray(body.content) ? body.content.map(item => record(item).type === "text" ? String(record(item).text ?? "") : "").join("\n") : "";
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("The business tool returned an invalid response."); }
  if (body.isError === true) return { status: "UNAVAILABLE", ...record(value) };
  return value;
}

/** A separate SDK client calls the existing MCP APIs; no telephony code is opened or modified. */
export async function openTextTestRuntime(input: { mode: TextTestMode; did: string; brand?: TextTestBrand | undefined }, signal: AbortSignal): Promise<TextTestRuntime> {
  const did = input.did;
  let brand: TextTestBrand | null = null;
  let path = "/api/ai/mcp/onboarding-call/", profile: Record<string, unknown> = {}, initialMapping: Awaited<ReturnType<typeof getDidMappingByDid>> = null;
  if (input.mode === "onboarding") {
    if (process.env.AI_ONBOARDING_ENABLED !== "true" || !configuredOnboardingDids().includes(did)) throw new TextRuntimeError(503, "configuration", undefined, "Select an approved onboarding number and enable AI_ONBOARDING_ENABLED in the backend.");
  } else {
    let route;
    try { route = await resolveVoiceProductForDid(did); }
    catch { throw new TextRuntimeError(503, "did_mapping", undefined, "The selected DID could not be resolved to an active product queue. Refresh the numbers and check its mapping."); }
    brand = route.brand;
    if (input.brand && input.brand !== brand) throw new TextRuntimeError(409, "did_mapping", undefined, "This DID belongs to another product. Refresh the mapped numbers.");
    const matches = (await Promise.all([getDidMappingByDid(did), getDidMappingByDid(`+${did}`)])).filter(row => row !== null);
    if (matches.length !== 1) throw new TextRuntimeError(409, "did_mapping", undefined, "The selected DID mapping is missing or ambiguous.");
    initialMapping = matches[0]!;
    path = brand === "black" ? "/api/bms-black/ai/mcp/" : brand === "pink" ? "/api/bms-pink/ai/mcp/" : "/api/bms-blue/ai/mcp/";
  }
  const secret = (input.mode === "onboarding" ? process.env.AI_ONBOARDING_BRIDGE_SECRET : process.env.AI_VOICE_BRIDGE_SECRET)?.trim() ?? "";
  if (secret.length < 32) throw new TextRuntimeError(503, "configuration", undefined, `Configure ${input.mode === "onboarding" ? "AI_ONBOARDING_BRIDGE_SECRET" : "AI_VOICE_BRIDGE_SECRET"} in the backend before starting this test.`);
  const origin = process.env.AI_TEXT_TEST_MCP_ORIGIN?.trim() || `http://127.0.0.1:${process.env.PORT?.trim() || "5050"}`;
  const url = new URL(path, origin);
  const client = new Client({ name: "command-center-sophie-text-test", version: "1.0.0" }, { capabilities: {} });
  client.onerror = () => {};
  const binding: Record<string, string> = {};
  let stage = "initialize", lastHttpStatus: number | undefined;
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${secret}`, "X-BMSPro-DID": did,
      ...(input.mode === "onboarding" ? { "X-BMSPro-Onboarding-Call": randomUUID() } : {}) }, redirect: "error" },
    fetch: async (target, init) => {
      const headers = new Headers(init?.headers);
      for (const [key, value] of Object.entries(binding)) headers.set(key, value);
      const response = await fetch(target, { ...init, headers, redirect: "error", signal: init?.method === "DELETE" ? AbortSignal.timeout(5000) : AbortSignal.any([signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(120000)]) });
      // GET 405 is normal for stateless MCP endpoints; keep only failed RPCs.
      if (!response.ok && init?.method !== "GET" && init?.method !== "DELETE") lastHttpStatus = response.status;
      return response;
    },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  };
  try {
    await client.connect(transport as unknown as Transport, { timeout: 20000, signal });
    stage = "tool_inventory";
    const inventory = await client.listTools({}, { timeout: 20000, signal });
    const allowed = input.mode === "onboarding" ? onboardingTools : receptionistTools;
    const enabled = inventory.tools.filter(tool => allowed.has(tool.name));
    let instructions: string;
    if (input.mode === "onboarding") {
      stage = "onboarding_profile";
      const resource = await client.readResource({ uri: "bmspro://onboarding/call" }, { timeout: 20000, signal });
      const contents = resource.contents.find(item => "text" in item);
      profile = JSON.parse(contents && "text" in contents ? contents.text : "{}");
      if (profile.mode !== "onboarding" || profile.did !== did) throw new Error("Onboarding session identity mismatch.");
      instructions = `${String(profile.voiceInstructions ?? "")} ${String(profile.backendInstructions ?? "")}`;
    } else {
      stage = "business_profile";
      const name = brand === "black" ? "get_workshop_profile" : "get_business_profile";
      profile = record(decode(await client.callTool({ name, arguments: {} }, undefined, { timeout: 45000, signal })));
      if (profile.brand !== brand || String(profile.did ?? "").replace(/^\+/, "") !== did) throw new Error("Business profile does not match the selected DID.");
      if (brand === "trade" && typeof profile.businessId === "string") binding["X-BMSPro-Trade-Business"] = profile.businessId;
      instructions = `You are Sophie, the AI receptionist for this verified ${brand} business. Profile: ${JSON.stringify(profile)}. Use get_business_profile or get_workshop_profile and list_services for verified business knowledge, hours, services, pricing and identity. Never invent missing facts, availability, policies, transfers or callbacks. Read list_services before checking availability and use only returned service IDs. ${brand === "black" ? "Black slots are vehicle drop-off times, not exclusive mechanic appointments. Ask for vehicle type if pricing varies by vehicle." : brand === "trade" ? "Trade morning/afternoon sessions are inspection preferences. Collect the site address and required contact details." : "Pink appointments currently accept one service. Use a returned unexpired slotToken."} Before submitting any booking or inspection request, read back all service, date/time, branch/location and customer contact details, and ask for explicit confirmation in a separate message. Call the write tool only after the user confirms. Say confirmed only for CONFIRMED; PENDING_REVIEW requires business review. UNKNOWN or PROCESSING must be verified by staff and must not be resubmitted. Never read internal IDs, tokens or request keys to the user. The tool inventory determines whether booking creation is enabled.`;
    }
    if (!enabled.length) throw new Error("The selected MCP service advertises no supported tools.");
    let submission: { fingerprint: string; result: unknown } | undefined;
    const privateRequestKey = randomUUID();
    const names = new Set(enabled.map(tool => tool.name));
    const tools: TextFunctionTool[] = enabled.map(tool => {
      const parameters = structuredClone(tool.inputSchema) as Record<string, unknown>;
      if (writes.has(tool.name)) {
        const properties = record(parameters.properties); delete properties.requestKey;
        if (Array.isArray(parameters.required)) parameters.required = parameters.required.filter(key => key !== "requestKey");
      }
      return { type: "function", name: tool.name, description: tool.description || tool.name, parameters, strict: false };
    });
    const branch = record(profile.branch);
    if (input.mode === "receptionist") {
      const timezone = String(branch.timezone || branch.timeZone || profile.timezone || "Australia/Sydney");
      const calendar = localCalendar(new Date(), timezone);
      instructions += ` Current local date is ${calendar.date}; local time is ${calendar.time}; timezone is ${timezone}.`;
    }
    return {
      mode: input.mode, did, brand,
      label: input.mode === "onboarding" ? "BMS Pro business onboarding" : String(branch.salonName || profile.businessName || profile.workshopName || initialMapping?.workshop_name || "Mapped business"),
      instructions, tools, close,
      async call(name, args, requestSignal) {
        if (closed || !names.has(name)) throw new Error("The tool is not available in this text session.");
        if (["tenantId", "ownerUid", "branchId", "businessId", "requestKey"].some(key => Object.hasOwn(args, key))) return { status: "REJECTED", message: "Business scope and request identity are controlled by the server." };
        if (initialMapping) {
          const current = await getDidMappingByDid(initialMapping.did);
          const product = await resolveVoiceProductForDid(did);
          if (!current || product.brand !== brand || current.owner_id !== initialMapping.owner_id || current.branch_id !== initialMapping.branch_id || current.queue_id !== initialMapping.queue_id)
            throw new Error("The DID assignment changed. End this test and start a new session.");
        }
        // Onboarding already has a versioned, durable creation checkpoint and
        // must allow callers to resolve missing fields after a rejected attempt.
        const write = writes.has(name) && name !== "complete_business_onboarding";
        const fingerprint = createHash("sha256").update(JSON.stringify([name, args], (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest("hex");
        if (write && submission) return submission.fingerprint === fingerprint ? submission.result : { status: "REJECTED", message: "This session already submitted an action. Check its outcome; start a new test for another request." };
        if (write) submission = { fingerprint, result: { status: "UNKNOWN", message: "The submission outcome is unverified. Check the real system before retrying." } };
        try {
          const schema = enabled.find(tool => tool.name === name)!.inputSchema;
          const toolArgs = write && Object.hasOwn(schema.properties ?? {}, "requestKey") ? { ...args, requestKey: privateRequestKey } : args;
          const result = decode(await client.callTool({ name, arguments: toolArgs }, undefined, { timeout: 100000, signal: requestSignal }));
          if (write) submission!.result = result;
          return result;
        } catch {
          if (write) return submission!.result;
          throw new Error("The live business tool is unavailable. No verified information was returned.");
        }
      },
    };
  } catch {
    const status = lastHttpStatus;
    const hint = status === 401 ? "The backend bridge credential does not match this MCP service."
      : status === 403 ? "The selected DID's AI receptionist, business or branch assignment is unavailable. Review its AI Receptionists setup."
      : status === 404 ? "The selected product's MCP endpoint is disabled or missing. Check its product feature flag."
      : status === 429 ? "The MCP request limit was reached. Wait briefly before starting another test."
      : stage === "business_profile" ? "The selected business profile could not be verified. Check that its dedicated AI receptionist is active and matches the current DID mapping."
      : stage === "onboarding_profile" ? "The onboarding profile is unavailable. Check the onboarding number, operator and approved terms."
      : "The local MCP connection failed or timed out. Check the backend MCP address and availability.";
    await close();
    throw new TextRuntimeError(status === 429 ? 429 : 503, stage, status, `Text test failed at ${stage}${status ? ` (MCP HTTP ${status})` : ""}. ${hint}`);
  }
}
