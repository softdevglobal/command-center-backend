import { Router } from "express";

import { requireSuperAdminOrSetup } from "../../middleware/super-admin-or-setup.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import {
  getSystemAuditLogById,
  listSystemAuditLogs,
} from "../../services/system-audit-logs.service.js";
import type { SystemAuditLogListFilters } from "../../types/system-audit-log.types.js";

const router = Router();

router.use(requireSuperAdminOrSetup);

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

/**
 * GET /api/system-audit-logs
 * Query: userId, action, resourceType, resourceId, from, to, limit (default 50, max 200), offset
 */
router.get("/", async (req, res) => {
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
router.get("/:id", async (req, res) => {
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
