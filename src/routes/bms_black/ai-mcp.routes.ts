import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { getDidMappingByDid } from "../../services/did-mappings.service.js";
import { aiAgentUid } from "../../services/bms_black/ai-reception.service.js";
import type { FrontOfficeBrandAdapter, FrontOfficeTenantContext } from "../../services/ai/brand-adapter.js";
import { blackFrontOfficeAdapter } from "../../services/bms_black/front-office.adapter.js";
import { availabilityArguments, bookingArguments, createFrontOfficeBookingTools } from "../../services/ai/front-office-booking.service.js";

type TenantConfiguration = {
  did: string;
  token: string;
  brand: "black";
  blackAgentUid: string;
};

type McpSession = {
  configuration: TenantConfiguration;
  adapter: FrontOfficeBrandAdapter;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastSeenAt: number;
};

const router = Router();
const sessions = new Map<string, McpSession>();
const requestWindows = new Map<string, { startedAt: number; count: number }>();
const SESSION_TTL_MS = 15 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 120;
const adapters: Record<string, FrontOfficeBrandAdapter> = {
  black: blackFrontOfficeAdapter,
};

function enabled(): boolean {
  return process.env.AI_FEATURE_ENABLED === "true" &&
    process.env.AI_VOICE_PROVIDER === "yeastar" &&
    process.env.AI_MCP_ENABLED === "true";
}

function loadTenantConfigurations(): TenantConfiguration[] {
  const raw = process.env.AI_MCP_TENANT_CONFIG_JSON?.trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI MCP tenant configuration is invalid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("AI MCP tenant configuration must be a JSON array.");

  const output: TenantConfiguration[] = [];
  const dids = new Set<string>();
  const tokens: string[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") throw new Error("AI MCP tenant entry is invalid.");
    const item = entry as Record<string, unknown>;
    if (
      typeof item.did !== "string" ||
      typeof item.token !== "string" ||
      typeof item.brand !== "string" ||
      typeof item.blackAgentUid !== "string" ||
      !item.blackAgentUid.trim()
    ) {
      throw new Error("Each AI MCP tenant needs did, token, brand, and blackAgentUid.");
    }
    const did = item.did.trim();
    const token = item.token.trim();
    if (!did || !token || item.brand !== "black") {
      throw new Error("AI MCP currently supports configured BMS Black tenants only.");
    }
    if (token.length < 32) throw new Error("Each AI MCP token must contain at least 32 characters.");
    if (dids.has(did) || tokens.includes(token)) {
      throw new Error("AI MCP tenant DIDs and tokens must be unique.");
    }
    dids.add(did);
    tokens.push(token);
    output.push({
      did,
      token,
      brand: "black",
      blackAgentUid: item.blackAgentUid.trim(),
    });
  }
  return output;
}

function suppliedBearer(req: Request): string {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? "";
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function authenticateTenant(req: Request): Promise<TenantConfiguration | null> {
  const bearer = suppliedBearer(req);
  if (!bearer) return null;
  const bridgeSecret = process.env.AI_VOICE_BRIDGE_SECRET?.trim();
  if (bridgeSecret && bridgeSecret.length >= 32 && safeEqual(bridgeSecret, bearer)) {
    if (loadTenantConfigurations().some(entry => safeEqual(entry.token, bridgeSecret))) {
      throw new Error("The voice bridge credential must differ from per-tenant MCP credentials.");
    }
    const did = req.header("x-bmspro-did")?.trim() ?? "";
    if (!/^\d{6,15}$/.test(did)) return null;
    // Accept only an exact mapped number, allowing the optional international +.
    // Never guess country codes or select the first of ambiguous mappings.
    const matches = (await Promise.all([getDidMappingByDid(did), getDidMappingByDid(`+${did}`)]))
      .filter(mapping => mapping?.tenant_id && mapping.owner_id && mapping.branch_id);
    if (matches.length !== 1) return null;
    const mapping = matches[0]!;
    if (!mapping) return null;
    return {did: mapping.did, token: bearer, brand: "black", blackAgentUid: aiAgentUid(mapping.did)};
  }
  return loadTenantConfigurations().find((entry) => safeEqual(entry.token, bearer)) ?? null;
}

function allowRequest(token: string): boolean {
  const key = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || current.startedAt + RATE_WINDOW_MS <= now) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function sendDisabled(res: Response): void {
  res.status(404).json({ error: "Yeastar AI tools are disabled." });
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

async function resolveCurrentTenant(
  configuration: TenantConfiguration,
): Promise<FrontOfficeTenantContext> {
  const mapping = await getDidMappingByDid(configuration.did);
  if (!mapping || !mapping.tenant_id || !mapping.owner_id || !mapping.branch_id) {
    throw new Error("The configured DID is not mapped to an active Black workshop and branch.");
  }
  return {
    did: mapping.did,
    tenantId: mapping.tenant_id,
    ownerId: mapping.owner_id,
    branchId: mapping.branch_id,
    branchName: mapping.branch_name,
    workshopName: mapping.workshop_name,
  };
}

function createMcpSession(configuration: TenantConfiguration): McpSession {
  const adapter = adapters[configuration.brand];
  if (!adapter) throw new Error(`No front-office adapter is registered for ${configuration.brand}.`);
  const server = new McpServer({ name: "bmspro-black-front-office", version: "1.0.0" });
  const bookingTools = createFrontOfficeBookingTools(adapter, () => resolveCurrentTenant(configuration));

  server.tool(
    "get_workshop_profile",
    "Get the business and branch assigned to this receptionist. The DID-to-workshop mapping is resolved by the server; callers cannot select a tenant.",
    {},
    async () => {
      const context = await resolveCurrentTenant(configuration);
      const branch = await adapter.getBranch(context);
      return textResult({
        brand: adapter.brand,
        did: context.did,
        workshopName: context.workshopName,
        branchName: context.branchName,
        branch,
      });
    },
  );

  server.tool(
    "list_services",
    "List the services configured for this receptionist's assigned workshop branch. This does not check appointment availability. Use these results for service questions; do not invent prices or durations.",
    {},
    async () => {
      const context = await resolveCurrentTenant(configuration);
      return textResult({
        brand: adapter.brand,
        workshopName: context.workshopName,
        branchName: context.branchName,
        services: await adapter.listServices(context),
      });
    },
  );

  server.tool("get_available_slots",
    "Get available DROP-OFF times for the assigned Black workshop branch and selected services. These are not exclusive mechanic appointments. Use the returned branch timezone and slotToken. The workshop's AI permission determines whether Sophie may confirm; only a CONFIRMED creation result means the booking is confirmed.",
    availabilityArguments.shape,
    async args => textResult(await bookingTools.getAvailableSlots(args)),
  );
  if (process.env.AI_MCP_BOOKINGS_ENABLED === "true") {
    server.tool("create_booking",
      "Create a Black booking using a slotToken from get_available_slots. Collect the customer's name, email and phone, read back the service, branch, date and local drop-off time, and get explicit confirmation before submitting. Say confirmed only when the result status is CONFIRMED. If PENDING_REVIEW, explain that the workshop must review it. Reuse the same details on retries; transfer to staff for UNKNOWN/PROCESSING results.",
      bookingArguments.shape,
      async args => textResult(await bookingTools.createBooking(args)),
    );
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized(sessionId) {
      sessions.set(sessionId, {
        configuration,
        adapter,
        server,
        transport,
        lastSeenAt: Date.now(),
      });
    },
  });

  const session: McpSession = {
    configuration,
    adapter,
    server,
    transport,
    lastSeenAt: Date.now(),
  };
  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId) sessions.delete(sessionId);
    void server.close().catch(() => undefined);
  };
  return session;
}

function reapExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (session.lastSeenAt + SESSION_TTL_MS <= now) {
      sessions.delete(sessionId);
      void session.transport.close().catch(() => undefined);
      void session.server.close().catch(() => undefined);
    }
  }
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  if (!enabled()) {
    sendDisabled(res);
    return;
  }

  let configuration: TenantConfiguration | null;
  try {
    configuration = await authenticateTenant(req);
  } catch (error) {
    console.error(`[ai mcp] Configuration error: ${error instanceof Error ? error.message : "unknown"}`);
    res.status(503).json({ error: "Yeastar AI tools are not configured." });
    return;
  }
  if (!configuration) {
    res.status(401).json({ error: "Invalid receptionist credential." });
    return;
  }
  if (!allowRequest(`${configuration.token}:${configuration.did}`)) {
    res.status(429).json({ error: "Receptionist tool request limit reached." });
    return;
  }

  reapExpiredSessions();
  const sessionId = req.header("mcp-session-id")?.trim();
  if (!sessionId) {
    if (req.method !== "POST") {
      res.status(400).json({ error: "MCP initialization requires POST." });
      return;
    }
    try {
      // Fail closed before handing out a session if its DID is unmapped.
      await resolveCurrentTenant(configuration);
    } catch {
      res.status(403).json({ error: "This receptionist DID has no active Black workshop mapping." });
      return;
    }
    const session = createMcpSession(configuration);
    try {
      // The SDK's transport optional-property declaration conflicts with this
      // repository's exactOptionalPropertyTypes setting in its v1 release.
      await session.server.connect(session.transport as unknown as Transport);
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[ai mcp] Session initialization failed: ${error instanceof Error ? error.message : "unknown"}`);
      if (!res.headersSent) res.status(500).json({ error: "Could not initialize receptionist tools." });
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
    }
    return;
  }

  const session = sessions.get(sessionId);
  if (!session || session.configuration.did !== configuration.did || !safeEqual(session.configuration.token, configuration.token)) {
    res.status(404).json({ error: "MCP session not found." });
    return;
  }
  session.lastSeenAt = Date.now();
  try {
    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`[ai mcp] Request failed: ${error instanceof Error ? error.message : "unknown"}`);
    if (!res.headersSent) res.status(500).json({ error: "Receptionist tool request failed." });
  }
}

router.all("/", (req, res) => {
  void handleMcpRequest(req, res);
});

export default router;
