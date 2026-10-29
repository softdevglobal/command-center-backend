import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { resolveVoiceProductForDid } from "../../services/ai/voice-route.service.js";

const router = Router();

function validBridgeCredential(value: string): boolean {
  const expected = process.env.AI_VOICE_BRIDGE_SECRET?.trim() ?? "";
  if (expected.length < 32 || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

router.post("/", async (req, res) => {
  if (process.env.AI_FEATURE_ENABLED !== "true" || process.env.AI_VOICE_PROVIDER !== "yeastar" || process.env.AI_MCP_ENABLED !== "true") {
    res.status(404).json({ error: "Voice MCP routing is disabled." }); return;
  }
  const bearer = /^Bearer\s+(.+)$/i.exec((req.header("authorization") ?? "").trim())?.[1]?.trim() ?? "";
  if (!validBridgeCredential(bearer)) { res.status(401).json({ error: "Invalid voice bridge credential." }); return; }
  const did = req.header("x-bmspro-did")?.trim() ?? "";
  try {
    const route = await resolveVoiceProductForDid(did);
    if (route.brand === "trade" && process.env.AI_MCP_TRADE_ENABLED !== "true") {
      res.status(404).json({ error: "Trade MCP is disabled." }); return;
    }
    if (route.brand === "pink" && process.env.AI_MCP_PINK_ENABLED !== "true") {
      res.status(404).json({ error: "Pink MCP is disabled." }); return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(route);
  } catch {
    res.status(404).json({ error: "DID is not mapped to an available voice product." });
  }
});

router.all("/", (_req, res) => { res.setHeader("Allow", "POST"); res.status(405).json({ error: "Use POST with the authenticated DID header." }); });

export default router;
