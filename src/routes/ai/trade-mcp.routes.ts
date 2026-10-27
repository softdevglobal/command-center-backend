import { createHash } from "node:crypto";
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TradeAgentIdentityError } from "../../services/ai/trade-agent-identity.service.js";
import {
  authenticateTradeMcpRequest, resolveTradeBusiness,
  getTradeBusinessProfile, listTradeServices, getTradeAvailability, createTradeInspectionRequest,
  tradeAvailabilityArguments, tradeRequestArguments, type TradeMcpTenant,
} from "../../services/ai/trade-front-office.service.js";

const router = Router();
const windows = new Map<string, { count: number; expires: number }>();
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export function tradeMcpToolFailure(tool: string, error: unknown) {
  const setupRequired = error instanceof TradeAgentIdentityError;
  const submission = tool === "create_inspection_request";
  const code = setupRequired ? "RECEPTIONIST_SETUP_REQUIRED" : "TRADE_TOOL_UNAVAILABLE";
  console.warn("[trade-mcp] Tool failed", { tool, code });
  const message = setupRequired
    ? "The receptionist could not authenticate. This attempt did not submit an inspection request. Tell the caller you are unable to submit it right now and offer staff help. Do not claim it is saved, pending review or confirmed."
    : submission
      ? "The submission result could not be verified. Tell the caller you cannot confirm whether it was saved and staff must check. Keep the original requestKey; do not create another submission."
      : "The business tool is unavailable. Do not invent availability or proceed to submission; offer staff help.";
  return { ...result({ status: setupRequired ? "REJECTED" : submission ? "UNKNOWN" : "UNAVAILABLE", code, message }), isError: true };
}

export function createTradeMcpServer(tenant: TradeMcpTenant) {
  const server = new McpServer({ name: "bmspro-trade-front-office", version: "1.0.0" });
  const scopedTenant = tenant;
  const safeTool = (tool: string, run: () => Promise<unknown>) => async () => {
    try { return result(await run()); } catch (error) { return tradeMcpToolFailure(tool, error); }
  };
  server.tool("get_business_profile", "Get this receptionist's assigned Trade business. Business selection is controlled by the server.", {}, safeTool("get_business_profile", () => getTradeBusinessProfile(scopedTenant)));
  server.tool("list_services", "List active services for the assigned Trade business. Do not invent pricing or availability.", {}, safeTool("list_services", () => listTradeServices(scopedTenant)));
  server.tool("get_available_slots", "Get unavailable morning/afternoon sessions for a date range. Other sessions are customer preferences; the business owner can allow Sophie to confirm only when staff assignment succeeds.", tradeAvailabilityArguments.shape,
    async args => safeTool("get_available_slots", () => getTradeAvailability(scopedTenant, args))());
  if (process.env.AI_MCP_TRADE_REQUESTS_ENABLED === "true") {
    server.tool("create_inspection_request", "Submit an inspection request after get_available_slots succeeds. Collect service, customer contact, site address and preferred sessions, asking only for missing details. Read the details back once and obtain explicit confirmation. Tell the caller you are submitting, call this tool once, then explain its result plainly. CONFIRMED: the inspection is booked. PENDING_REVIEW: the request is received and the business must approve the visit. REJECTED: explain the problem and offer staff help; do not say it was received. UNKNOWN: say you cannot verify whether it was saved and staff must check. Never claim a transfer or callback unless that action succeeds. Do not read internal codes or request keys to the caller. Generate a requestKey of at least 16 characters per customer request and reuse it and identical details on retries. Never use a new key for an UNKNOWN result.", tradeRequestArguments.shape,
      async args => safeTool("create_inspection_request", () => createTradeInspectionRequest(scopedTenant, args))());
  }
  return server;
}

router.post("/", async (req, res) => {
  if (process.env.AI_FEATURE_ENABLED !== "true" || process.env.AI_VOICE_PROVIDER !== "yeastar" || process.env.AI_MCP_ENABLED !== "true" || process.env.AI_MCP_TRADE_ENABLED !== "true") {
    res.status(404).json({ error: "Trade AI tools are disabled." }); return;
  }
  let tenant;
  try {
    const bearer = /^Bearer\s+(.+)$/i.exec((req.header("authorization") ?? "").trim())?.[1]?.trim() ?? "";
    tenant = await authenticateTradeMcpRequest(bearer, req.header("x-bmspro-did")?.trim() ?? "");
  } catch {
    res.status(503).json({ error: "Trade MCP configuration is invalid." }); return;
  }
  if (!tenant) { res.status(401).json({ error: "Invalid Trade receptionist credential." }); return; }
  // This optional binding can only restrict the DID's actual business; it never
  // selects a different business. Tools revalidate it again at execution time.
  const binding = req.header("x-bmspro-trade-business");
  if (binding !== undefined) {
    if (!binding.trim() || binding.length > 128 || binding.includes("/") || binding === "." || binding === "..") {
      res.status(400).json({ error: "Invalid Trade call binding." }); return;
    }
    tenant = { ...tenant, pinnedBusinessId: binding.trim() };
  }
  const now = Date.now();
  for (const [key, window] of windows) if (window.expires <= now) windows.delete(key);
  const key = createHash("sha256").update(`${tenant.token}:${tenant.did}`).digest("hex");
  const window = windows.get(key) ?? { count: 0, expires: now + 60000 };
  if (++window.count > 120) { res.status(429).json({ error: "Receptionist tool request limit reached." }); return; }
  windows.set(key, window);
  try { await resolveTradeBusiness(tenant); } catch {
    res.status(403).json({ error: "Trade receptionist business is unavailable or its booking link is invalid." }); return;
  }
  // Stateless HTTP matches the existing onboarding MCP pattern and works across backend replicas.
  const server = createTradeMcpServer(tenant);
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => { void transport.close().catch(() => undefined); void server.close().catch(() => undefined); });
  try {
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "Trade MCP request failed." });
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});
router.all("/", (_req, res) => { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Use stateless MCP POST requests." }); });
export default router;
