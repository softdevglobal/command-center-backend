import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireSuperAdminOrSetup } from "../../middleware/super-admin-or-setup.middleware.js";
import { getSuperAdminRoleForInsert } from "../../config/supabase-app-role.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

const router = Router();
const eventTypes = ["call_started", "call_answered", "call_ended", "mcp_tool", "usage_updated"] as const;
const ingestSchema = z.object({
  eventId: z.string().uuid(),
  callId: z.string().uuid(),
  eventType: z.enum(eventTypes),
  mode: z.enum(["receptionist", "trade", "onboarding"]),
  brand: z.enum(["black", "trade", "onboarding"]),
  did: z.string().regex(/^\d{6,15}$/),
  businessName: z.string().trim().max(160).optional(),
  branchName: z.string().trim().max(160).optional(),
  model: z.string().trim().max(100).optional(),
  toolName: z.string().trim().max(100).optional(),
  status: z.string().trim().max(100).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  inputBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  outputBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

function matchesSecret(candidate: string, expected: string | undefined): boolean {
  if (!expected || !candidate || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function validIngestCredential(req: import("express").Request): boolean {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  const mode = (req.body as { mode?: string } | undefined)?.mode;
  if (mode === "onboarding") return matchesSecret(token, process.env.AI_ONBOARDING_BRIDGE_SECRET);
  return matchesSecret(token, process.env.AI_VOICE_BRIDGE_SECRET);
}

function safeUsage(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const result: Record<string, unknown> = {};
  const walk = (source: Record<string, unknown>, target: Record<string, unknown>, depth: number) => {
    if (depth > 4) return;
    for (const [key, value] of Object.entries(source)) {
      if (!/token/i.test(key)) continue;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) target[key.slice(0, 80)] = value;
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested: Record<string, unknown> = {};
        walk(value as Record<string, unknown>, nested, depth + 1);
        if (Object.keys(nested).length) target[key.slice(0, 80)] = nested;
      }
    }
  };
  walk(raw, result, 0);
  return result;
}

function adminClient() {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new Error(missing.length ? `Missing Supabase env: ${missing.join(", ")}.` : "Supabase is not configured.");
  }
  return createSupabaseClient(url, key);
}

// Ingest only from the voice bridge. Store identifiers, safe counters, and token counts;
// never persist caller audio, transcripts, tool arguments, or tool result payloads.
router.post("/events", async (req, res) => {
  if (!validIngestCredential(req)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid agent activity event." }); return; }
  const event = parsed.data;
  const row = {
    id: event.eventId,
    call_id: event.callId,
    event_type: event.eventType,
    mode: event.mode,
    brand: event.brand,
    did: event.did,
    business_name: event.businessName ?? null,
    branch_name: event.branchName ?? null,
    model: event.model ?? null,
    tool_name: event.toolName ?? null,
    status: event.status ?? null,
    duration_ms: event.durationMs ?? null,
    input_bytes: event.inputBytes ?? null,
    output_bytes: event.outputBytes ?? null,
    usage: safeUsage(event.usage),
    occurred_at: event.occurredAt,
  };
  try {
    const { error } = await adminClient().from("ai_agent_activity_events").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    res.status(202).json({ accepted: true });
  } catch (error) {
    console.error("[ai agent activity] Ingest failed", error instanceof Error ? error.message : "unknown");
    res.status(503).json({ error: "Activity storage is unavailable." });
  }
});

router.get("/events", requireSuperAdminOrSetup, async (req, res) => {
  const auth = res.locals.superAdminAuth;
  const superAdminRoles = new Set([getSuperAdminRoleForInsert(), "super_admin", "super-admin", "superadmin"]);
  if (auth?.kind !== "bearer" || !auth.roles.some((role: string) => superAdminRoles.has(role))) {
    res.status(403).json({ error: "Sign in as a super admin to view AI agent activity." }); return;
  }
  const limitRaw = Number.parseInt(String(req.query.limit ?? "100"), 10);
  const offsetRaw = Number.parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Math.min(500, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 100));
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
  try {
    let query = adminClient().from("ai_agent_activity_events").select("*", { count: "exact" }).order("occurred_at", { ascending: false });
    const brand = typeof req.query.brand === "string" ? req.query.brand : "";
    const mode = typeof req.query.mode === "string" ? req.query.mode : "";
    const did = typeof req.query.did === "string" ? req.query.did.trim() : "";
    const eventType = typeof req.query.eventType === "string" ? req.query.eventType : "";
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (["black", "trade", "onboarding"].includes(brand)) query = query.eq("brand", brand);
    if (["receptionist", "trade", "onboarding"].includes(mode)) query = query.eq("mode", mode);
    if (/^\d{6,15}$/.test(did)) query = query.eq("did", did);
    if ((eventTypes as readonly string[]).includes(eventType)) query = query.eq("event_type", eventType);
    if (from && !Number.isNaN(Date.parse(from))) query = query.gte("occurred_at", from);
    if (to && !Number.isNaN(Date.parse(to))) query = query.lte("occurred_at", to);
    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ data: data ?? [], total: count ?? 0, limit, offset });
  } catch (error) {
    console.error("[ai agent activity] List failed", error instanceof Error ? error.message : "unknown");
    res.status(503).json({ error: "Could not load AI agent activity." });
  }
});

export default router;
