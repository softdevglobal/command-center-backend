import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { attachSupabaseUser, requireSupabaseSuperAdmin } from "../../middleware/supabase-auth.middleware.js";
import { createTextTestService, TextTestError, type TextTestService } from "../../services/ai/text-test.service.js";
import { textTestOptions, TextRuntimeError } from "../../services/ai/text-test-runtime.service.js";

export function createTextTestRouter(options: { service?: TextTestService; authorize?: RequestHandler[]; listOptions?: typeof textTestOptions; enabled?: () => boolean } = {}) {
  const router = Router(), service = options.service ?? createTextTestService();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!(options.enabled?.() ?? process.env.AI_TEXT_TEST_ENABLED === "true")) { res.status(404).json({ error: "Text testing is disabled." }); return; }
    next();
  });
  router.use(...(options.authorize ?? [attachSupabaseUser, requireSupabaseSuperAdmin]));
  const action = (run: (req: Parameters<RequestHandler>[0], owner: string, signal: AbortSignal) => Promise<unknown>): RequestHandler => async (req, res) => {
    const owner = res.locals.supabaseAuth?.user?.id;
    if (typeof owner !== "string" || !owner) { res.status(401).json({ error: "Sign in as a super admin." }); return; }
    const controller = new AbortController();
    res.once("close", () => { if (!res.writableEnded) controller.abort(); });
    try { const result = await run(req, owner, controller.signal); if (!res.destroyed) res.json(result); }
    catch (error) {
      console.warn("[sophie-text-test] Request failed", { route: req.route?.path, ...(error instanceof TextRuntimeError ? { stage: error.stage, mcpStatus: error.httpStatus ?? null } : {}), code: error instanceof TextTestError ? error.status : error instanceof z.ZodError ? "INVALID_INPUT" : "TEXT_SERVICE_UNAVAILABLE" });
      if (!res.destroyed) res.status(error instanceof TextTestError || error instanceof TextRuntimeError ? error.status : error instanceof z.ZodError ? 400 : 503)
        .json({ error: error instanceof TextTestError || error instanceof TextRuntimeError ? error.message : error instanceof z.ZodError ? "Check the required text-test fields." : "The text test could not complete. Check the MCP service and any submitted record before retrying.", ...(error instanceof TextRuntimeError ? { stage: error.stage, mcpStatus: error.httpStatus ?? null } : {}) });
    }
  };
  router.get("/options", action(async () => (options.listOptions ?? textTestOptions)()));
  router.post("/sessions", action((req, owner, signal) => service.start(owner, req.body, signal)));
  router.post("/sessions/:id/messages", action((req, owner, signal) => service.message(owner, String(req.params.id), req.body, signal)));
  router.post("/sessions/:id/end", action((req, owner) => service.end(owner, String(req.params.id))));
  return router;
}
export default createTextTestRouter();
