import { Router } from "express";

import {
  requireSupabaseSuperAdmin,
} from "../../middleware/supabase-auth.middleware.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import { getDidMappingByDid } from "../../services/did-mappings.service.js";
import { mockVoiceMediaAdapter } from "../../services/ai/mock-voice-media.adapter.js";
import {
  closeMockVoiceSession,
  createMockVoiceSession,
  handleMockVoiceTurn,
} from "../../services/ai/mock-voice-session.service.js";

const router = Router();

function mockModeEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.AI_FEATURE_ENABLED === "true" &&
    process.env.AI_VOICE_PROVIDER === "mock"
  );
}

function sessionIdFromParam(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw;
  return Array.isArray(raw) ? raw[0] ?? "" : "";
}

router.use((req, res, next) => {
  if (!mockModeEnabled()) {
    res.status(404).json({ error: "AI mock routes are disabled." });
    return;
  }
  next();
});

router.use(attachSupabaseUser, requireSupabaseSuperAdmin);

/** Start a text-only local simulation. Tenant context comes from the server DID map. */
router.post("/sessions", async (req, res) => {
  const did = typeof req.body?.did === "string" ? req.body.did.trim() : "";
  if (!did || did.length > 40 || !/^[+0-9() .-]+$/.test(did)) {
    res.status(400).json({ error: "Provide a valid mapped DID." });
    return;
  }

  try {
    const mapping = await getDidMappingByDid(did);
    if (!mapping) {
      res.status(404).json({ error: "No DID mapping was found." });
      return;
    }

    const session = createMockVoiceSession({
      did: mapping.did,
      tenantId: mapping.tenant_id,
      branchId: mapping.branch_id,
      businessName: mapping.workshop_name,
    });
    await mockVoiceMediaAdapter.open({
      sessionId: session.sessionId,
      tenantId: session.tenant.tenantId,
      did: session.tenant.did,
    });

    res.status(201).json({ ok: true, simulated: true, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ai mock] Could not resolve DID mapping: ${message}`);
    res.status(500).json({ error: "Could not resolve the mapped DID." });
  }
});

/** Process one ephemeral text turn; caller text is never retained or logged. */
router.post("/sessions/:sessionId/turns", (req, res) => {
  const sessionId = sessionIdFromParam(req.params.sessionId);
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 2000) {
    res.status(400).json({ error: "Provide text between 1 and 2000 characters." });
    return;
  }

  const result = handleMockVoiceTurn(sessionId, text);
  if (!result) {
    res.status(404).json({ error: "Mock session not found or expired." });
    return;
  }

  res.json({ ok: true, ...result });
});

router.post("/sessions/:sessionId/close", async (req, res) => {
  const sessionId = sessionIdFromParam(req.params.sessionId);
  if (!closeMockVoiceSession(sessionId)) {
    res.status(404).json({ error: "Mock session not found or already closed." });
    return;
  }

  await mockVoiceMediaAdapter.close(sessionId);
  res.json({ ok: true, simulated: true, status: "closed" });
});

export default router;
