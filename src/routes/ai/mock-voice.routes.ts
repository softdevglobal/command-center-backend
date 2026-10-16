import { Router } from "express";
import { randomUUID } from "node:crypto";

import {
  requireSupabaseSuperAdmin,
} from "../../middleware/supabase-auth.middleware.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import { getDidMappingByDid } from "../../services/did-mappings.service.js";
import { mockVoiceMediaAdapter } from "../../services/ai/mock-voice-media.adapter.js";
import { MockTelephonyControlAdapter } from "../../services/ai/mock-telephony-control.adapter.js";
import { VoiceCallOrchestrator } from "../../services/ai/voice-call-orchestrator.service.js";
import type { InboundCallContext } from "../../services/ai/telephony-control-adapter.js";
import {
  closeMockVoiceSession,
  createMockVoiceSession,
  handleMockVoiceTurn,
} from "../../services/ai/mock-voice-session.service.js";

const router = Router();
const callIdsBySession = new Map<string, string>();
const mockTelephonyControl = new MockTelephonyControlAdapter(async (did): Promise<InboundCallContext | null> => {
  const mapping = await getDidMappingByDid(did);
  if (!mapping?.tenant_id || !mapping.queue_id) return null;
  return {
    did: mapping.did,
    tenantId: mapping.tenant_id,
    brand: "black",
    branchId: mapping.branch_id,
    timeZone: null,
    humanFallback: mapping.queue_id,
  };
});
const voiceOrchestrator = new VoiceCallOrchestrator(mockTelephonyControl, mockVoiceMediaAdapter);

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
    const callId = randomUUID();
    const call = await voiceOrchestrator.startInbound({
      eventId: randomUUID(),
      callId,
      did,
      occurredAt: new Date().toISOString(),
      kind: "inbound_started",
    });
    const mapping = await getDidMappingByDid(call.did);
    if (!mapping) throw new Error("Mapped DID disappeared during mock session setup.");
    const session = createMockVoiceSession({
      did: mapping.did,
      tenantId: call.tenantId,
      branchId: call.branchId,
      businessName: mapping.workshop_name,
    }, Date.now(), call.sessionId);
    callIdsBySession.set(session.sessionId, callId);

    res.status(201).json({ ok: true, simulated: true, session, callStatus: call.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ai mock] Could not resolve DID mapping: ${message}`);
    res.status(404).json({ error: "Could not start a mock call for this DID. Check the mapping and human fallback." });
  }
});

/** Process one ephemeral text turn; caller text is never retained or logged. */
router.post("/sessions/:sessionId/turns", async (req, res) => {
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

  if (result.handoffRequested) {
    const callId = callIdsBySession.get(sessionId);
    if (!callId) {
      res.status(409).json({ error: "Mock call control context is no longer available." });
      return;
    }
    try {
      await voiceOrchestrator.handoffToStaff(callId);
      callIdsBySession.delete(sessionId);
    } catch {
      res.status(502).json({ error: "Mock handoff failed; no live call was placed." });
      return;
    }
  }

  res.json({ ok: true, ...result });
});

router.post("/sessions/:sessionId/close", async (req, res) => {
  const sessionId = sessionIdFromParam(req.params.sessionId);
  if (!closeMockVoiceSession(sessionId)) {
    res.status(404).json({ error: "Mock session not found or already closed." });
    return;
  }

  const callId = callIdsBySession.get(sessionId);
  if (callId) {
    try {
      await voiceOrchestrator.close(callId);
    } catch {
      // This is a local simulator; cleanup should continue even if mock control is stale.
    }
    callIdsBySession.delete(sessionId);
  } else {
    await mockVoiceMediaAdapter.close(sessionId);
  }
  res.json({ ok: true, simulated: true, status: "closed" });
});

export default router;
