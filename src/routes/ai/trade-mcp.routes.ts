import { createHash } from "node:crypto";
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  authenticateTradeMcpRequest, resolveTradeBusiness,
  getTradeBusinessProfile, listTradeServices, getTradeAvailability, createTradeInspectionRequest,
  tradeAvailabilityArguments, tradeRequestArguments, type TradeMcpTenant,
} from "../../services/ai/trade-front-office.service.js";

const router = Router();
const windows = new Map<string, { count: number; expires: number }>();
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export function createTradeMcpServer(tenant: TradeMcpTenant) {
  const server = new McpServer({ name: "bmspro-trade-front-office", version: "1.0.0" });
  const scopedTenant = tenant;
  const safeTool = (run: () => Promise<unknown>) => async () => {
    try { return result(await run()); } catch { return { ...result({ error: "Trade tool could not complete. Verify details or transfer to staff; do not claim a request was saved." }), isError: true }; }
  };
  server.tool("get_business_profile", "Get this receptionist's assigned Trade business. Business selection is controlled by the server.", {}, safeTool(() => getTradeBusinessProfile(scopedTenant)));
  server.tool("list_services", "List active services for the assigned Trade business. Do not invent pricing or availability.", {}, safeTool(() => listTradeServices(scopedTenant)));
  server.tool("get_available_slots", "Get unavailable morning/afternoon sessions for a date range. Other sessions are customer preferences subject to staff review; never promise a confirmed appointment.", tradeAvailabilityArguments.shape,
    async args => safeTool(() => getTradeAvailability(scopedTenant, args))());
  if (process.env.AI_MCP_TRADE_REQUESTS_ENABLED === "true") {
    server.tool("create_inspection_request", "Submit an inspection request for staff review. Collect service, customer contact, site address and preferred sessions; read everything back and obtain explicit confirmation. Generate a requestKey of at least 16 characters per customer request and reuse it and identical details on retries. For UNKNOWN transfer to staff and never use a new key. Only PENDING_REVIEW means submitted; never say confirmed.", tradeRequestArguments.shape,
      async args => safeTool(() => createTradeInspectionRequest(scopedTenant, args))());
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
