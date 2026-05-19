import { Router } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import {
  agentMayViewCall,
  getCallById,
  listCalls,
  toPublicCall,
  toPublicCalls,
} from "../../services/calls.service.js";
import { resolveAgentIdForUserViaSupabase } from "../../services/shared/calls.pipeline.js";
import type { CallDirection, CallListFilters } from "../../types/call.types.js";

const router = Router();

router.use(attachSupabaseUser);

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function queryInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function queryBool(value: unknown): boolean {
  return value === "true" || value === "1";
}

/** `YYYY-MM-DD` → UTC start/end of that calendar day for `start_time` filtering. */
function dayBoundsFromDateParam(
  date: string
): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== month - 1 ||
    start.getUTCDate() !== day
  ) {
    return null;
  }
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return { from: start.toISOString(), to: end.toISOString() };
}

function parseDirection(
  query: Record<string, unknown>
): CallDirection | undefined | { error: string } {
  const raw = queryString(query.direction)?.toLowerCase();
  const inbound = queryBool(query.inbound);
  const outbound = queryBool(query.outbound);

  if (inbound && outbound) {
    return {
      error: "Use either inbound or outbound filter, not both.",
    };
  }

  if (raw) {
    if (raw !== "inbound" && raw !== "outbound") {
      return {
        error: 'direction must be "inbound" or "outbound".',
      };
    }
    return raw;
  }

  if (inbound) return "inbound";
  if (outbound) return "outbound";
  return undefined;
}

type ParseListFiltersResult =
  | { ok: true; filters: CallListFilters }
  | { ok: false; error: string };

function parseListFilters(req: {
  query: Record<string, unknown>;
}): ParseListFiltersResult {
  const filters: CallListFilters = {};
  const tenantId = queryString(req.query.tenantId);
  const queueId = queryString(req.query.queueId);
  const agentId = queryString(req.query.agentId);
  const callerName =
    queryString(req.query.callerName) ?? queryString(req.query.caller_name);
  const result = queryString(req.query.result);
  const from = queryString(req.query.from);
  const to = queryString(req.query.to);
  const date = queryString(req.query.date);
  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);

  const direction = parseDirection(req.query);
  if (direction && typeof direction === "object" && "error" in direction) {
    return { ok: false, error: direction.error };
  }

  if (tenantId) filters.tenantId = tenantId;
  if (queueId) filters.queueId = queueId;
  if (agentId) filters.agentId = agentId;
  if (callerName) filters.callerName = callerName;
  if (direction && typeof direction === "string") filters.direction = direction;
  if (result) filters.result = result;

  if (date) {
    const bounds = dayBoundsFromDateParam(date);
    if (!bounds) {
      return {
        ok: false,
        error: 'date must be a valid calendar day in YYYY-MM-DD format (e.g. 2026-05-16).',
      };
    }
    filters.from = from ?? bounds.from;
    filters.to = to ?? bounds.to;
  } else {
    if (from) filters.from = from;
    if (to) filters.to = to;
  }

  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  return { ok: true, filters };
}

function isSuperAdmin(roles: string[]): boolean {
  return roles.some((r) => roleMayRegisterAgents(r));
}

function isAgent(roles: string[]): boolean {
  return roles.includes("agent");
}

type CallsAccess =
  | { kind: "super-admin"; includeRecording: true }
  | { kind: "agent"; agentId: string; includeRecording: false };

async function resolveCallsAccess(
  roles: string[],
  userId: string
): Promise<CallsAccess | { error: string; status: number }> {
  if (isSuperAdmin(roles)) {
    return { kind: "super-admin", includeRecording: true };
  }

  if (!isAgent(roles)) {
    return {
      status: 403,
      error:
        "Only super admins or agents may access calls. Sign in with an account that has the appropriate user_roles entry.",
    };
  }

  const agentId = await resolveAgentIdForUserViaSupabase({ userId });
  if (!agentId) {
    return {
      status: 403,
      error:
        "No agent record linked to this user. Ensure agents.user_id matches your Supabase Auth user id.",
    };
  }

  return { kind: "agent", agentId, includeRecording: false };
}

function authExtras(res: import("express").Response) {
  const auth = res.locals.supabaseAuth;
  if (!auth) return {};
  return {
    authenticatedAs: sessionSummaryFromLocals({
      user: auth.user,
      roles: auth.roles,
    }),
  };
}

/**
 * GET /api/calls
 * Filters (super admin and agent): callerName, direction|inbound|outbound, date|from|to, tenantId, queueId, limit, offset.
 * Super admin only: agentId. Agent scope is always their answered calls.
 */
router.get("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveCallsAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const parsed = parseListFilters(req);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  const filters = parsed.filters;
  if (access.kind === "agent") {
    filters.scopeAgentId = access.agentId;
    delete filters.agentId;
  }

  try {
    const result = await listCalls(filters);
    res.json({
      success: true,
      ...result,
      data: toPublicCalls(result.data, access.includeRecording),
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list calls";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/calls/:id
 */
router.get("/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveCallsAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const raw = req.params.id;
  const id =
    typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";

  try {
    const row = await getCallById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "Call not found." });
      return;
    }

    if (access.kind === "agent" && !agentMayViewCall(row, access.agentId)) {
      res.status(404).json({ success: false, error: "Call not found." });
      return;
    }

    res.json({
      success: true,
      data: toPublicCall(row, access.includeRecording),
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load call";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
