import { Router } from "express";

import { requireSuperAdminOrSetup } from "../../middleware/super-admin-or-setup.middleware.js";
import {
  attachSupabaseUser,
  type SupabaseAuthLocals,
} from "../../middleware/supabase-auth.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import {
  createSystemAuditLog,
  getSystemAuditLogById,
  listSystemAuditLogs,
} from "../../services/system-audit-logs.service.js";
import type {
  CreateSystemAuditLogRequestBody,
  SystemAuditLogListFilters,
} from "../../types/system-audit-log.types.js";

const router = Router();

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function queryInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseListFilters(req: {
  query: Record<string, unknown>;
}): SystemAuditLogListFilters {
  const filters: SystemAuditLogListFilters = {};
  const userId = queryString(req.query.userId);
  const action = queryString(req.query.action);
  const resourceType = queryString(req.query.resourceType);
  const resourceId = queryString(req.query.resourceId);
  const from = queryString(req.query.from);
  const to = queryString(req.query.to);
  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);

  if (userId) filters.userId = userId;
  if (action) filters.action = action;
  if (resourceType) filters.resourceType = resourceType;
  if (resourceId) filters.resourceId = resourceId;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  return filters;
}

function authExtras(res: import("express").Response) {
  const auth = res.locals.superAdminAuth;
  if (!auth || auth.kind === "setup-secret") {
    return { authMode: "x-setup-secret" as const };
  }
  return {
    authMode: "bearer" as const,
    authenticatedAs: sessionSummaryFromLocals({
      user: auth.user,
      roles: auth.roles,
    }),
  };
}

function nameFromAuth(auth: SupabaseAuthLocals): string {
  const meta = auth.user.user_metadata as Record<string, unknown> | undefined;
  const displayName = meta?.display_name;
  if (typeof displayName === "string" && displayName.trim()) {
    return displayName.trim();
  }
  const fullName = meta?.full_name;
  if (typeof fullName === "string" && fullName.trim()) {
    return fullName.trim();
  }
  return auth.user.email ?? auth.user.id;
}

function roleFromAuth(auth: SupabaseAuthLocals): string {
  return auth.roles[0] ?? "user";
}

/**
 * POST /api/system-audit-logs
 * Bearer only. Body: { action, resourceType, resourceId?, details? }
 * `user_id`, `user_name`, and `user_role` are derived from the logged-in user.
 */
router.post("/", attachSupabaseUser, async (req, res) => {
  const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;
  if (!auth) {
    res.status(500).json({ success: false, error: "Internal auth error" });
    return;
  }

  const body = req.body as CreateSystemAuditLogRequestBody;
  const action = String(body?.action ?? "").trim();
  const resourceType = String(body?.resourceType ?? "").trim();

  if (!action || !resourceType) {
    res.status(400).json({
      success: false,
      error: "action and resourceType are required.",
    });
    return;
  }

  if (
    body.details !== undefined &&
    body.details !== null &&
    (typeof body.details !== "object" || Array.isArray(body.details))
  ) {
    res.status(400).json({
      success: false,
      error: "details must be a JSON object when provided.",
    });
    return;
  }

  try {
    const data = await createSystemAuditLog({
      userId: auth.user.id,
      userName: nameFromAuth(auth),
      userRole: roleFromAuth(auth),
      action,
      resourceType,
      resourceId:
        body.resourceId === undefined || body.resourceId === null
          ? null
          : String(body.resourceId),
      details: body.details ?? {},
    });

    res.status(201).json({
      success: true,
      data,
      authMode: "bearer" as const,
      authenticatedAs: sessionSummaryFromLocals(auth),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create audit log";
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /api/system-audit-logs
 * Query: userId, action, resourceType, resourceId, from, to, limit (default 50, max 200), offset
 */
router.get("/", requireSuperAdminOrSetup, async (req, res) => {
  try {
    const result = await listSystemAuditLogs(parseListFilters(req));
    res.json({ success: true, ...result, ...authExtras(res) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list audit logs";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/system-audit-logs/:id
 */
router.get("/:id", requireSuperAdminOrSetup, async (req, res) => {
  const raw = req.params.id;
  const id =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";

  try {
    const row = await getSystemAuditLogById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "Audit log not found." });
      return;
    }
    res.json({ success: true, data: row, ...authExtras(res) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load audit log";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
