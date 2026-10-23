import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getDidMappingByDid } from "../../services/did-mappings.service.js";
import { onboardingService, assertVoiceOnboardingOperator } from "../../services/ai/onboarding.repository.js";
import { createLiveOnboardingTools, liveOnboardingToolSpecifications } from "../../services/ai/live-onboarding.service.js";
import { OnboardingError, type OnboardingService } from "../../services/ai/onboarding.service.js";

const digest = (value: string) => createHash("sha256").update(value).digest();
const profileUri = "bmspro://onboarding/call";
export function createOnboardingCallRouter(options: {
  service?: OnboardingService;
  authorizeOperator?: (operatorId: string) => Promise<void>;
  getMapping?: typeof getDidMappingByDid;
} = {}) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.AI_ONBOARDING_ENABLED !== "true") { res.status(404).json({ error: "Onboarding is disabled." }); return; }
    const secret = process.env.AI_ONBOARDING_BRIDGE_SECRET?.trim() ?? "";
    if (secret.length < 32 || secret === process.env.AI_VOICE_BRIDGE_SECRET?.trim()) {
      res.status(503).json({ error: "Configure a separate onboarding bridge credential." }); return;
    }
    const supplied = /^Bearer\s+(.+)$/i.exec(req.header("authorization") ?? "")?.[1]?.trim() ?? "";
    if (!supplied || !timingSafeEqual(digest(supplied), digest(secret))) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  });
  router.post("/", async (req, res) => {
    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    try {
      const did = z.string().regex(/^\d{6,15}$/).parse(req.header("x-bmspro-did"));
      const callId = z.string().uuid().parse(req.header("x-bmspro-onboarding-call"));
      let configured: unknown;
      try { configured = JSON.parse(process.env.AI_ONBOARDING_DIDS_JSON ?? "[]"); }
      catch { throw new OnboardingError(503, "ROUTES_UNAVAILABLE", "Onboarding routes are not configured correctly."); }
      const dids = z.array(z.string().regex(/^\d{6,15}$/)).max(20).parse(configured);
      if (!dids.includes(did)) throw new OnboardingError(403, "ROUTE_NOT_ALLOWED", "This number is not approved for onboarding.");
      const getMapping = options.getMapping ?? getDidMappingByDid;
      const mappings = await Promise.all([getMapping(did), getMapping(`+${did}`)]);
      if (mappings.some(mapping => mapping !== null)) {
        throw new OnboardingError(409, "WORKSHOP_ROUTE_CONFLICT", "This number is assigned to a workshop. Choose a separate onboarding number.");
      }
      const operatorId = z.string().uuid().parse(process.env.AI_ONBOARDING_OPERATOR_ID);
      let terms: unknown;
      try { terms = JSON.parse(process.env.AI_ONBOARDING_APPROVED_TERMS_JSON ?? "null"); }
      catch { throw new OnboardingError(503, "TERMS_UNAVAILABLE", "Published onboarding terms are unavailable."); }
      const runtime = await createLiveOnboardingTools({
        service: options.service ?? onboardingService,
        sessionId: `bridge:${did}:${callId}`, operatorId, terms,
        authorizeOperator: () => (options.authorizeOperator ?? assertVoiceOnboardingOperator)(operatorId),
        isEnabled: () => process.env.AI_ONBOARDING_ENABLED === "true",
      });
      server = new McpServer({ name: "bmspro-onboarding-call", version: "1.0.0" });
      for (const specification of liveOnboardingToolSpecifications) {
        server.registerTool(specification.name, { description: specification.description, inputSchema: specification.schema }, async (args: unknown) => {
          try { return { content: [{ type: "text" as const, text: JSON.stringify(await runtime.execute(specification.name, args)) }] }; }
          catch (error) {
            // Record a stable diagnostic without logging caller details, setup
            // fields, provider errors or private password-setup links.
            console.warn("[onboarding-call] Tool rejected", {
              tool: specification.name,
              code: error instanceof OnboardingError ? error.code : error instanceof z.ZodError ? "INVALID_ARGUMENTS" : "ONBOARDING_UNAVAILABLE",
            });
            const result = error instanceof OnboardingError ? { code: error.code, error: error.message }
              : error instanceof z.ZodError ? { code: "INVALID_ARGUMENTS", error: "Clarify the collected fields.", issues: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) }
                : { code: "ONBOARDING_UNAVAILABLE", error: "Check the current setup status before retrying. Do not claim success." };
            return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
          }
        });
      }
      server.resource("onboarding-call-profile", profileUri, async () => ({ contents: [{ uri: profileUri, mimeType: "application/json", text: JSON.stringify({
        mode: "onboarding", did, voiceInstructions: runtime.instructions, backendInstructions: runtime.backendInstructions,
        greeting: "Introduce yourself as BMS Pro's AI onboarding assistant, explain that setup details are saved, and ask if the caller would like help setting up their business.",
      }) }] }));
      transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      const activeServer = server;
      const activeTransport = transport;
      res.once("close", () => { void activeTransport.close().catch(() => undefined); void activeServer.close().catch(() => undefined); });
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      await transport?.close().catch(() => undefined);
      await server?.close().catch(() => undefined);
      if (!res.headersSent) {
        const status = error instanceof OnboardingError ? error.status : error instanceof z.ZodError ? 400 : 503;
        res.status(status).json({ error: error instanceof OnboardingError ? error.message : "Onboarding call setup is unavailable. Check its route, settings and database migration." });
      }
    }
  });
  router.all("/", (_req, res) => { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Use stateless MCP POST requests." }); });
  return router;
}

export default createOnboardingCallRouter();
