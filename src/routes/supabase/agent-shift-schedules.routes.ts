import { Router } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  agentMayViewShiftSchedule,
  getAgentShiftScheduleByAgentId,
  listAgentShiftSchedules,
  upsertAgentShiftSchedule,
} from "../../services/agent-shift-schedules.service.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import { resolveAttendanceTarget } from "../../services/shared/agent-attendance-target.js";
import {
  AGENT_SHIFT_SCHEDULE_WEEKDAYS,
  type AgentShiftScheduleDayValues,
  type AgentShiftScheduleListFilters,
} from "../../types/agent-shift-schedule.types.js";

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

type ShiftScheduleAccess =
  | { kind: "super-admin" }
  | { kind: "agent"; agentId: string };

async function resolveShiftScheduleAccess(
  roles: string[],
  authUserId: string
): Promise<ShiftScheduleAccess | { error: string; status: number }> {
  if (isSuperAdmin(roles)) {
    return { kind: "super-admin" };
  }

  if (!isAgent(roles)) {
    return {
      status: 403,
      error:
        "Only super admins or agents may access agent shift schedules. Sign in with an account that has the appropriate user_roles entry.",
    };
  }

  const target = await resolveAttendanceTarget({ defaultUserId: authUserId });
  if ("error" in target) return target;
  if (!target.agentId) {
    return {
      status: 403,
      error:
        "No agent record linked to this user. Ensure agents.user_id matches your Supabase Auth user id.",
    };
  }

  return { kind: "agent", agentId: target.agentId };
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

type ParsedScheduleDays =
  | { ok: true; value: AgentShiftScheduleDayValues }
  | { ok: false; error: string };

function parseScheduleDaysBody(body: unknown): ParsedScheduleDays {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const source = body as Record<string, unknown>;
  const days: AgentShiftScheduleDayValues = {};

  for (const day of AGENT_SHIFT_SCHEDULE_WEEKDAYS) {
    if (!Object.prototype.hasOwnProperty.call(source, day)) continue;

    const value = source[day];
    if (value === null) {
      days[day] = null;
      continue;
    }
    if (typeof value !== "string") {
      return {
        ok: false,
        error: `${day} must be a string shift value or null.`,
      };
    }
    days[day] = value.trim() || null;
  }

  return { ok: true, value: days };
}

async function resolveAgentIdFromQuery(input: {
  authUserId: string;
  query: Record<string, unknown>;
}): Promise<{ agentId?: string } | { error: string; status: number }> {
  const userId = queryString(input.query.userId);
  const agentId = queryString(input.query.agentId);

  if (!userId && !agentId) return {};

  const target = await resolveAttendanceTarget({
    defaultUserId: input.authUserId,
    ...(userId ? { userId } : {}),
    ...(agentId ? { agentId } : {}),
  });
  if ("error" in target) return target;
  if (!target.agentId) {
    return {
      status: 404,
      error: "No linked agent found for the requested user.",
    };
  }
  return { agentId: target.agentId };
}

async function resolveOwnAgentId(
  authUserId: string
): Promise<{ agentId: string } | { error: string; status: number }> {
  const target = await resolveAttendanceTarget({ defaultUserId: authUserId });
  if ("error" in target) return target;
  if (!target.agentId) {
    return {
      status: 404,
      error: "No agent schedule found because this user has no linked agent.",
    };
  }
  return { agentId: target.agentId };
}

function statusForWriteError(message: string): number {
  if (
    message.includes("required") ||
    message.includes("weekday") ||
    message.includes("must be a string")
  ) {
    return 400;
  }
  if (
    message.includes("foreign key") ||
    message.includes("agent_shift_schedules_agent_id_fkey")
  ) {
    return 404;
  }
  return 500;
}

/**
 * GET /api/agent-shift-schedules
 * Agent: own schedule only. Super admin: all schedules; optional ?agentId= or ?userId=.
 */
router.get("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveShiftScheduleAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const filters: AgentShiftScheduleListFilters = {};
  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  if (access.kind === "agent") {
    filters.scopeAgentId = access.agentId;
  } else {
    const target = await resolveAgentIdFromQuery({
      authUserId: auth.user.id,
      query: req.query as Record<string, unknown>,
    });
    if ("error" in target) {
      res.status(target.status).json({ success: false, error: target.error });
      return;
    }
    if (target.agentId) filters.agentId = target.agentId;
  }

  try {
    const result = await listAgentShiftSchedules(filters);
    res.json({
      success: true,
      ...result,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to list agent shift schedules";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-shift-schedules/me
 * Current agent's assigned schedule.
 */
router.get("/me", async (_req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveShiftScheduleAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const own =
    access.kind === "agent"
      ? { agentId: access.agentId }
      : await resolveOwnAgentId(auth.user.id);
  if ("error" in own) {
    res.status(own.status).json({ success: false, error: own.error });
    return;
  }

  try {
    const row = await getAgentShiftScheduleByAgentId(own.agentId);
    if (!row) {
      res.status(404).json({ success: false, error: "Shift schedule not found." });
      return;
    }

    res.json({
      success: true,
      data: row,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to load agent shift schedule";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-shift-schedules/:agentId
 * Agent: own schedule only. Super admin: any agent schedule.
 */
router.get("/:agentId", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveShiftScheduleAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const agentId = paramId(req.params.agentId).trim();
  if (!agentId) {
    res.status(400).json({ success: false, error: "agentId is required." });
    return;
  }
  if (access.kind === "agent" && agentId !== access.agentId) {
    res.status(404).json({ success: false, error: "Shift schedule not found." });
    return;
  }

  try {
    const row = await getAgentShiftScheduleByAgentId(agentId);
    if (!row) {
      res.status(404).json({ success: false, error: "Shift schedule not found." });
      return;
    }
    if (access.kind === "agent" && !agentMayViewShiftSchedule(row, access.agentId)) {
      res.status(404).json({ success: false, error: "Shift schedule not found." });
      return;
    }

    res.json({
      success: true,
      data: row,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to load agent shift schedule";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/agent-shift-schedules/:agentId
 * Super admin only. Body accepts any weekday keys: { monday, ..., sunday }.
 */
router.put("/:agentId", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveShiftScheduleAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }
  if (access.kind !== "super-admin") {
    res.status(403).json({
      success: false,
      error: "Only super admins may create or update shift schedules.",
    });
    return;
  }

  const agentId = paramId(req.params.agentId).trim();
  if (!agentId) {
    res.status(400).json({ success: false, error: "agentId is required." });
    return;
  }

  const parsed = parseScheduleDaysBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const result = await upsertAgentShiftSchedule({
      agentId,
      days: parsed.value,
    });
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: result.row,
      created: result.created,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to upsert agent shift schedule";
    res.status(statusForWriteError(msg)).json({ success: false, error: msg });
  }
});

export default router;
