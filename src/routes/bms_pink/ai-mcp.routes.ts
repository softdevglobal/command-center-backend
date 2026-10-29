import { createHash } from "node:crypto";
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PinkAgentIdentityError } from "../../services/bms_pink/pink-front-office.service.js";
import {
  authenticatePinkMcp,
  bindPinkMcpTenantToMapping,
  createPinkBooking,
  getPinkAvailability,
  getPinkBusinessProfile,
  listPinkServices,
  pinkAvailabilityArguments,
  pinkBookingArguments,
  resolvePinkBranch,
  type PinkMcpTenant,
} from "../../services/bms_pink/pink-front-office.service.js";

const router = Router();
const windows = new Map<string, { count: number; expires: number }>();
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

function toolFailure(tool: string, error: unknown) {
  const identity = error instanceof PinkAgentIdentityError;
  const submission = tool === "create_booking";
  const status = identity ? "REJECTED" : submission ? "UNKNOWN" : "UNAVAILABLE";
  const message = identity
    ? "Pink receptionist setup is unavailable. This attempt did not submit a booking; offer staff assistance."
    : submission
      ? "The booking result could not be verified. Staff must check it. Keep the same request key and do not claim it was saved or submit a new request."
      : "Pink business information could not be verified. Do not invent services or availability; offer staff assistance.";
  console.warn("[pink-mcp] Tool failed", { tool, code: identity ? error.code : "PINK_TOOL_UNAVAILABLE" });
  return { ...result({ status, message }), isError: true };
}

export function createPinkMcpServer(tenant: PinkMcpTenant) {
  const server = new McpServer({ name: "bmspro-pink-front-office", version: "1.0.0" });
  const safeTool = (name: string, run: () => Promise<unknown>) => async () => {
    try { return result(await run()); } catch (error) { return toolFailure(name, error); }
  };
  server.tool("get_business_profile", "Get the salon and branch assigned to this receptionist. Business and branch selection are controlled by the server.", {},
    safeTool("get_business_profile", () => getPinkBusinessProfile(tenant)));
  server.tool("list_services", "List active services at the assigned Pink branch. Use only returned service IDs, prices and durations.", {},
    safeTool("list_services", () => listPinkServices(tenant)));
  server.tool("get_available_slots", "Check Pink availability for selected active services and a date. The returned slotToken is short-lived; availability does not reserve a time.", pinkAvailabilityArguments.shape,
    async args => {
      try { return result(await getPinkAvailability(tenant, args)); }
      catch (error) { return toolFailure("get_available_slots", error); }
    });
  if (process.env.AI_MCP_PINK_BOOKINGS_ENABLED === "true") {
    server.tool("create_booking", "Submit a Pink booking only after checking availability and reading back the service, branch, local date/time and customer details for explicit confirmation. Use a requestKey of at least 16 characters and reuse the same key and details after any uncertain result. CONFIRMED means Pink confirmed it; PENDING_REVIEW means the salon must approve it; UNKNOWN means staff must verify it. Notification outcomes are included by channel: accepted means the email/SMS provider accepted the request, not that it reached the inbox or phone. Never promise delivery, claim success for UNKNOWN, or read internal IDs/request keys to the caller.", pinkBookingArguments.shape,
      async args => {
        try { return result(await createPinkBooking(tenant, args)); }
        catch (error) { return toolFailure("create_booking", error); }
      });
  }
  return server;
}

router.post("/", async (req, res) => {
  if (process.env.AI_FEATURE_ENABLED !== "true" || process.env.AI_VOICE_PROVIDER !== "yeastar" ||
      process.env.AI_MCP_ENABLED !== "true" || process.env.AI_MCP_PINK_ENABLED !== "true") {
    res.status(404).json({ error: "Pink AI tools are disabled." }); return;
  }
  let tenant: PinkMcpTenant | undefined;
  try {
    const bearer = /^Bearer\s+(.+)$/i.exec((req.header("authorization") ?? "").trim())?.[1]?.trim() ?? "";
    tenant = await authenticatePinkMcp(bearer, req.header("x-bmspro-did")?.trim() ?? "");
  } catch {
    res.status(503).json({ error: "Pink MCP configuration is invalid." }); return;
  }
  if (!tenant) { res.status(401).json({ error: "Invalid Pink receptionist credential." }); return; }

  try { tenant = await bindPinkMcpTenantToMapping(tenant); }
  catch { res.status(403).json({ error: "Pink DID is not mapped to an active salon branch and Pink queue." }); return; }

  const now = Date.now();
  for (const [key, window] of windows) if (window.expires <= now) windows.delete(key);
  const key = createHash("sha256").update(`${tenant.token}:${tenant.did}`).digest("hex");
  const window = windows.get(key) ?? { count: 0, expires: now + 60_000 };
  if (++window.count > 120) { res.status(429).json({ error: "Receptionist tool request limit reached." }); return; }
  windows.set(key, window);
  try { await resolvePinkBranch(tenant); }
  catch {
    res.status(403).json({ error: "Pink receptionist branch is unavailable or its assignment is invalid." }); return;
  }

  // Stateless transport supports horizontally scaled backend replicas.
  const server = createPinkMcpServer(tenant);
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.once("close", () => { void transport.close().catch(() => undefined); void server.close().catch(() => undefined); });
  try {
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "Pink MCP request failed." });
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});

router.all("/", (_req, res) => { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Use stateless MCP POST requests." }); });
export default router;
