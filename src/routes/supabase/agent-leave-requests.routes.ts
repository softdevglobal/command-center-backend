import { Router } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  createAgentLeaveRequest,
  deletePendingAgentLeaveRequest,
  getAgentLeaveRequestById,
  isDateOnly,
  listAgentLeaveRequests,
  reviewAgentLeaveRequest,
  userMayViewLeaveRequest,
} from "../../services/agent-leave-requests.service.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import { resolveAttendanceTarget } from "../../services/shared/agent-attendance-target.js";
import {
  isAgentLeaveDurationType,
  isAgentLeaveHalfDayPart,
  isAgentLeaveRequestStatus,
} from "../../services/shared/supabase-agent-leave-requests.service.js";
import type {
  AgentLeaveHalfDayPart,
  AgentLeaveRequestCreateInput,
  AgentLeaveRequestListFilters,
  AgentLeaveReviewStatus,
} from "../../types/agent-leave-request.types.js";

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

type LeaveAccess =
  | { kind: "super-admin" }
  | { kind: "agent"; userId: string };

function resolveLeaveAccess(
  roles: string[],
  authUserId: string
): LeaveAccess | { error: string; status: number } {
  if (isSuperAdmin(roles)) {
    return { kind: "super-admin" };
  }

  if (!isAgent(roles)) {
    return {
      status: 403,
      error:
        "Only super admins or agents may access agent leave requests. Sign in with an account that has the appropriate user_roles entry.",
    };
  }

  return { kind: "agent", userId: authUserId };
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

type ParseListFiltersResult =
  | { ok: true; filters: AgentLeaveRequestListFilters }
  | { ok: false; error: string };

function parseListFilters(req: {
  query: Record<string, unknown>;
}): ParseListFiltersResult {
  const filters: AgentLeaveRequestListFilters = {};
  const tenantId = queryString(req.query.tenantId);
  const statusRaw = queryString(req.query.status);
  const from = queryString(req.query.from);
  const to = queryString(req.query.to);
  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);

  if (tenantId) filters.tenantId = tenantId;
  if (statusRaw) {
    if (!isAgentLeaveRequestStatus(statusRaw)) {
      return {
        ok: false,
        error: 'status must be one of: pending, approved, rejected.',
      };
    }
    filters.status = statusRaw;
  }
  if (from) {
    if (!isDateOnly(from)) {
      return { ok: false, error: "from must be a date in YYYY-MM-DD format." };
    }
    filters.from = from;
  }
  if (to) {
    if (!isDateOnly(to)) {
      return { ok: false, error: "to must be a date in YYYY-MM-DD format." };
    }
    filters.to = to;
  }
  if (from && to && to < from) {
    return { ok: false, error: "to must be the same as or after from." };
  }
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  return { ok: true, filters };
}

function bodyString(
  body: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function nullableBodyString(
  body: Record<string, unknown>,
  ...keys: string[]
): string | null | undefined {
  for (const key of keys) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null) return null;
    if (typeof value === "string") return value.trim() || null;
  }
  return undefined;
}

type ParsedCreateBody =
  | { ok: true; value: Omit<AgentLeaveRequestCreateInput, "userId"> }
  | { ok: false; error: string };

function parseCreateBody(body: unknown): ParsedCreateBody {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const source = body as Record<string, unknown>;
  const startDate = bodyString(source, "startDate", "start_date");
  const endDate = bodyString(source, "endDate", "end_date");
  const durationType = bodyString(source, "durationType", "duration_type");

  if (!startDate) return { ok: false, error: "startDate is required." };
  if (!endDate) return { ok: false, error: "endDate is required." };
  if (!durationType || !isAgentLeaveDurationType(durationType)) {
    return {
      ok: false,
      error: 'durationType is required and must be "full_day" or "half_day".',
    };
  }

  const halfDayPartRaw = nullableBodyString(
    source,
    "halfDayPart",
    "half_day_part"
  );
  let halfDayPart: AgentLeaveHalfDayPart | null | undefined;
  if (halfDayPartRaw === null) {
    halfDayPart = null;
  } else if (halfDayPartRaw !== undefined) {
    if (!isAgentLeaveHalfDayPart(halfDayPartRaw)) {
      return {
        ok: false,
        error: 'halfDayPart must be "am" or "pm" when provided.',
      };
    }
    halfDayPart = halfDayPartRaw;
  }

  const parsed: Omit<AgentLeaveRequestCreateInput, "userId"> = {
    startDate,
    endDate,
    durationType,
  };
  if (halfDayPart !== undefined) parsed.halfDayPart = halfDayPart;

  const reason = nullableBodyString(source, "reason");
  const tenantId = nullableBodyString(source, "tenantId", "tenant_id");
  const agentDisplayName = nullableBodyString(
    source,
    "agentDisplayName",
    "agent_display_name"
  );
  const attachmentStoragePath = nullableBodyString(
    source,
    "attachmentStoragePath",
    "attachment_storage_path"
  );

  if (reason !== undefined) parsed.reason = reason;
  if (tenantId !== undefined) parsed.tenantId = tenantId;
  if (agentDisplayName !== undefined) parsed.agentDisplayName = agentDisplayName;
  if (attachmentStoragePath !== undefined) {
    parsed.attachmentStoragePath = attachmentStoragePath;
  }

  return { ok: true, value: parsed };
}

function parseReviewStatus(value: unknown): AgentLeaveReviewStatus | null {
  if (typeof value !== "string") return null;
  const status = value.trim();
  if (status === "approved" || status === "rejected") return status;
  return null;
}

/**
 * GET /api/agent-leave-requests
 * Agent: own requests only. Super admin: all requests; optional ?userId= or ?agentId=.
 */
router.get("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveLeaveAccess(auth.roles, auth.user.id);
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
    filters.scopeUserId = access.userId;
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
    const result = await listAgentLeaveRequests(filters);
    res.json({
      success: true,
      ...result,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to list agent leave requests";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/agent-leave-requests
 * Body: { startDate, endDate, durationType, halfDayPart?, reason?, attachmentStoragePath? }
 */
router.post("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveLeaveAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const parsed = parseCreateBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const userId = bodyString(body, "userId", "user_id");
  const agentId = bodyString(body, "agentId", "agent_id");
  const target = await resolveAttendanceTarget({
    defaultUserId: auth.user.id,
    ...(userId ? { userId } : {}),
    ...(agentId ? { agentId } : {}),
  });
  if ("error" in target) {
    res.status(target.status).json({ success: false, error: target.error });
    return;
  }
  if (access.kind === "agent" && target.userId !== access.userId) {
    res.status(403).json({
      success: false,
      error: "Agents may only create leave requests for themselves.",
    });
    return;
  }

  try {
    const row = await createAgentLeaveRequest({
      userId: target.userId,
      ...parsed.value,
    });
    res.status(201).json({
      success: true,
      data: row,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to create agent leave request";
    const status =
      msg.includes("required") ||
      msg.includes("YYYY-MM-DD") ||
      msg.includes("halfDayPart") ||
      msg.includes("endDate")
        ? 400
        : 500;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-leave-requests/:id
 */
router.get("/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveLeaveAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const id = paramId(req.params.id);

  try {
    const row = await getAgentLeaveRequestById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "Leave request not found." });
      return;
    }

    if (access.kind === "agent" && !userMayViewLeaveRequest(row, access.userId)) {
      res.status(404).json({ success: false, error: "Leave request not found." });
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
      e instanceof Error ? e.message : "Failed to load agent leave request";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/agent-leave-requests/:id
 * Agents may delete only their own pending requests before super admin review.
 */
router.delete("/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveLeaveAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }
  if (access.kind !== "agent") {
    res.status(403).json({
      success: false,
      error: "Only agents may delete their own pending leave requests.",
    });
    return;
  }

  const id = paramId(req.params.id);

  try {
    const existing = await getAgentLeaveRequestById(id);
    if (!existing || !userMayViewLeaveRequest(existing, access.userId)) {
      res.status(404).json({ success: false, error: "Leave request not found." });
      return;
    }
    if (existing.status !== "pending") {
      res.status(409).json({
        success: false,
        error:
          "Only pending leave requests can be deleted. This request has already been reviewed.",
      });
      return;
    }

    const deleted = await deletePendingAgentLeaveRequest(id, access.userId);
    if (!deleted) {
      res.status(409).json({
        success: false,
        error:
          "Leave request could not be deleted because it is no longer pending.",
      });
      return;
    }

    res.json({
      success: true,
      data: deleted,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to delete agent leave request";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/agent-leave-requests/:id/review
 * Super admin only. Body: { status: "approved"|"rejected", reviewComment? }
 */
router.patch("/:id/review", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = resolveLeaveAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }
  if (access.kind !== "super-admin") {
    res.status(403).json({
      success: false,
      error: "Only super admins may approve or reject leave requests.",
    });
    return;
  }

  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ success: false, error: "Request body must be a JSON object." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const status = parseReviewStatus(body.status);
  if (!status) {
    res.status(400).json({
      success: false,
      error: 'status is required and must be "approved" or "rejected".',
    });
    return;
  }

  const reviewComment = nullableBodyString(
    body,
    "reviewComment",
    "review_comment"
  );

  try {
    const row = await reviewAgentLeaveRequest(paramId(req.params.id), {
      status,
      reviewedBy: auth.user.id,
      ...(reviewComment !== undefined ? { reviewComment } : {}),
    });
    if (!row) {
      res.status(404).json({ success: false, error: "Leave request not found." });
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
      e instanceof Error ? e.message : "Failed to review agent leave request";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
