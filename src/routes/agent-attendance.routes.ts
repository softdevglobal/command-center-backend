import { Router } from "express";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import { attachSupabaseUser } from "../middleware/supabase-auth.middleware.js";
import { sessionSummaryFromLocals } from "../services/auth/supabase-auth.service.js";
import {
  getAgentAttendanceEventById,
  getAgentAttendanceReport,
  getAgentAttendanceStatusForUser,
  listAgentAttendanceEvents,
  recordAgentAttendanceEvent,
  userMayViewAttendanceEvent,
} from "../services/agent-attendance.service.js";
import { enrichAttendanceCreateInput } from "../services/shared/agent-attendance-enrichment.js";
import { resolveAttendanceTarget } from "../services/shared/agent-attendance-target.js";
import { isAgentAttendanceEventType } from "../services/shared/supabase-agent-attendance.service.js";
import type {
  AgentAttendanceEventType,
  AgentAttendanceListFilters,
  AgentAttendanceReportFilters,
  AgentAttendanceReportGroupBy,
} from "../types/agent-attendance.types.js";

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

function paramId(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function isSuperAdmin(roles: string[]): boolean {
  return roles.some((r) => roleMayRegisterAgents(r));
}

function isAgent(roles: string[]): boolean {
  return roles.includes("agent");
}

type AttendanceAccess =
  | { kind: "super-admin" }
  | { kind: "agent"; userId: string };

function resolveAttendanceAccess(
  roles: string[],
  authUserId: string
): AttendanceAccess | { error: string; status: number } {
  if (isSuperAdmin(roles)) {
    return { kind: "super-admin" };
  }

  if (!isAgent(roles)) {
    return {
      status: 403,
      error:
        "Only super admins or agents may access agent attendance. Sign in with an account that has the appropriate user_roles entry.",
    };
  }

  return { kind: "agent", userId: authUserId };
}

function parseListFilters(req: {
  query: Record<string, unknown>;
}): AgentAttendanceListFilters {
  const filters: AgentAttendanceListFilters = {};
  const userId = queryString(req.query.userId);
  const tenantId = queryString(req.query.tenantId);
  const eventTypeRaw = queryString(req.query.eventType);
  const from = queryString(req.query.from);
  const to = queryString(req.query.to);
  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);

  if (userId) filters.userId = userId;
  if (tenantId) filters.tenantId = tenantId;
  if (eventTypeRaw && isAgentAttendanceEventType(eventTypeRaw)) {
    filters.eventType = eventTypeRaw;
  }
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  return filters;
}

function parseReportGroupBy(
  value: unknown
): AgentAttendanceReportGroupBy | undefined {
  const raw = queryString(value)?.toLowerCase();
  if (raw === "day" || raw === "week" || raw === "month") return raw;
  return undefined;
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

async function resolveTargetForRequest(
  access: AttendanceAccess,
  authUserId: string,
  query: Record<string, unknown>
): Promise<
  | { userId: string; agentId: string | null }
  | { error: string; status: number }
> {
  const userId = queryString(query.userId);
  const agentId = queryString(query.agentId);

  const target = await resolveAttendanceTarget({
    defaultUserId: authUserId,
    ...(userId ? { userId } : {}),
    ...(agentId ? { agentId } : {}),
  });

  if ("error" in target) {
    return target;
  }

  if (access.kind === "agent" && target.userId !== access.userId) {
    return {
      status: 403,
      error: "Agents may only access their own attendance.",
    };
  }

  return target;
}

/**
 * GET /api/agent-attendance/status
 * Query: agentId (agents.id) or userId (Auth UUID); defaults to self
 */
router.get("/status", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveAttendanceAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const target = await resolveTargetForRequest(
    access,
    auth.user.id,
    req.query as Record<string, unknown>
  );
  if ("error" in target) {
    res.status(target.status).json({ success: false, error: target.error });
    return;
  }

  try {
    const status = await getAgentAttendanceStatusForUser(
      target.userId,
      target.agentId
    );
    res.json({
      success: true,
      data: status,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load attendance status";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-attendance/reports
 * Query: groupBy=day|week|month, from=YYYY-MM-DD, to=YYYY-MM-DD, agentId?, tenantId?
 * Super admin: all agents (optional agentId filter). Agent: own history only.
 */
router.get("/reports", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveAttendanceAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const groupBy =
    parseReportGroupBy(req.query.groupBy) ??
    parseReportGroupBy(req.query.group_by) ??
    parseReportGroupBy(req.query.period);
  const from = queryString(req.query.from);
  const to = queryString(req.query.to);
  const tenantId = queryString(req.query.tenantId);

  if (!groupBy) {
    res.status(400).json({
      success: false,
      error: 'groupBy is required: "day", "week", or "month".',
    });
    return;
  }
  if (!from || !to) {
    res.status(400).json({
      success: false,
      error: "from and to are required (YYYY-MM-DD).",
    });
    return;
  }

  let scopeUserId: string | undefined;
  let resolvedAgentId: string | null = null;
  if (access.kind === "agent") {
    scopeUserId = access.userId;
  } else {
    const userId = queryString(req.query.userId);
    const agentId =
      queryString(req.query.agentId) ?? queryString(req.query.agent_id);
    if (userId || agentId) {
      const target = await resolveAttendanceTarget({
        defaultUserId: auth.user.id,
        ...(userId ? { userId } : {}),
        ...(agentId ? { agentId } : {}),
      });
      if ("error" in target) {
        res.status(target.status).json({ success: false, error: target.error });
        return;
      }
      scopeUserId = target.userId;
      resolvedAgentId = target.agentId;
    }
  }

  const filters: AgentAttendanceReportFilters = {
    groupBy,
    from,
    to,
    ...(scopeUserId ? { userId: scopeUserId } : {}),
    ...(tenantId ? { tenantId } : {}),
  };

  try {
    const report = await getAgentAttendanceReport(filters);
    res.json({
      success: true,
      ...report,
      filters_applied: {
        groupBy,
        from,
        to,
        ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
        ...(scopeUserId ? { userId: scopeUserId } : {}),
        ...(tenantId ? { tenantId } : {}),
      },
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to build attendance report";
    const status =
      msg.includes("from and to") ||
      msg.includes("Date range") ||
      msg.includes("groupBy")
        ? 400
        : 500;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-attendance/events
 * Query: userId (super admin), tenantId, eventType, from, to, limit, offset
 */
router.get("/events", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveAttendanceAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const eventTypeRaw = queryString(req.query.eventType);
  if (eventTypeRaw && !isAgentAttendanceEventType(eventTypeRaw)) {
    res.status(400).json({
      success: false,
      error:
        'eventType must be one of: clock_in, break_start, break_end, clock_out.',
    });
    return;
  }

  const filters = parseListFilters(req);
  if (access.kind === "agent") {
    filters.scopeUserId = access.userId;
    delete filters.userId;
  } else {
    const userId = queryString(req.query.userId);
    const agentId = queryString(req.query.agentId);
    if (userId || agentId) {
      const target = await resolveAttendanceTarget({
        defaultUserId: auth.user.id,
        ...(userId ? { userId } : {}),
        ...(agentId ? { agentId } : {}),
      });
      if ("error" in target) {
        res.status(target.status).json({ success: false, error: target.error });
        return;
      }
      filters.userId = target.userId;
    }
  }

  try {
    const result = await listAgentAttendanceEvents(filters);
    res.json({
      success: true,
      ...result,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list attendance events";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/agent-attendance/events
 * Body: { eventType, tenantId?, occurredAt?, agentDisplayName?, userId? (super admin) }
 */
router.post("/events", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveAttendanceAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const eventTypeRaw =
    typeof body.eventType === "string"
      ? body.eventType
      : typeof body.event_type === "string"
        ? body.event_type
        : "";

  if (!isAgentAttendanceEventType(eventTypeRaw)) {
    res.status(400).json({
      success: false,
      error:
        'eventType is required and must be one of: clock_in, break_start, break_end, clock_out.',
    });
    return;
  }

  const eventType = eventTypeRaw as AgentAttendanceEventType;
  const bodyUserId =
    typeof body.userId === "string"
      ? body.userId.trim()
      : typeof body.user_id === "string"
        ? body.user_id.trim()
        : "";
  const bodyAgentId =
    typeof body.agentId === "string"
      ? body.agentId.trim()
      : typeof body.agent_id === "string"
        ? body.agent_id.trim()
        : "";

  const target = await resolveAttendanceTarget({
    defaultUserId: auth.user.id,
    ...(bodyUserId ? { userId: bodyUserId } : {}),
    ...(bodyAgentId ? { agentId: bodyAgentId } : {}),
  });
  if ("error" in target) {
    res.status(target.status).json({ success: false, error: target.error });
    return;
  }
  if (access.kind === "agent" && target.userId !== access.userId) {
    res.status(403).json({
      success: false,
      error: "Agents may only record attendance for themselves.",
    });
    return;
  }
  const targetUserId = target.userId;

  const tenantId =
    body.tenantId === null || body.tenant_id === null
      ? null
      : typeof body.tenantId === "string"
        ? body.tenantId.trim() || null
        : typeof body.tenant_id === "string"
          ? body.tenant_id.trim() || null
          : undefined;

  const agentDisplayName =
    typeof body.agentDisplayName === "string"
      ? body.agentDisplayName
      : typeof body.agent_display_name === "string"
        ? body.agent_display_name
        : undefined;

  const occurredAt =
    typeof body.occurredAt === "string"
      ? body.occurredAt
      : typeof body.occurred_at === "string"
        ? body.occurred_at
        : undefined;

  if (occurredAt) {
    const parsed = Date.parse(occurredAt);
    if (!Number.isFinite(parsed)) {
      res.status(400).json({
        success: false,
        error: "occurredAt must be a valid ISO 8601 timestamp.",
      });
      return;
    }
  }

  try {
    const createInput = await enrichAttendanceCreateInput({
      userId: targetUserId,
      eventType,
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(agentDisplayName !== undefined ? { agentDisplayName } : {}),
      ...(occurredAt ? { occurredAt } : {}),
    });

    const row = await recordAgentAttendanceEvent(createInput);
    res.status(201).json({
      success: true,
      data: row,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to record attendance event";
    const status = msg.includes("Cannot record") ? 409 : 500;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-attendance/events/:id
 */
router.get("/events/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveAttendanceAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const id = paramId(req.params.id);

  try {
    const row = await getAgentAttendanceEventById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "Attendance event not found." });
      return;
    }

    if (
      access.kind === "agent" &&
      !userMayViewAttendanceEvent(row, access.userId)
    ) {
      res.status(404).json({ success: false, error: "Attendance event not found." });
      return;
    }

    res.json({
      success: true,
      data: row,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load attendance event";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
