import { Router, type NextFunction, type Request, type Response } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  createSalesAgentSuburbAssignment,
  deleteSalesAgentSuburbAssignment,
  getSalesAgentSuburbAssignmentById,
  listSalesAgentSuburbAssignments,
  updateSalesAgentSuburbAssignment,
} from "../../services/sales-agent-suburb-assignments.service.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import type {
  SalesAgentSuburbAssignmentInput,
  SalesAgentSuburbAssignmentListFilters,
  SalesAgentSuburbAssignmentUpdateInput,
} from "../../types/sales-agent-suburb-assignment.types.js";

const router = Router();

router.use(attachSupabaseUser);
router.use(requireSalesAgentSuburbAssignmentSuperAdmin);

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

function requireSalesAgentSuburbAssignmentSuperAdmin(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const auth = res.locals.supabaseAuth;
  const roles = auth?.roles ?? [];
  if (!roles.some((r: string) => roleMayRegisterAgents(r))) {
    res.status(403).json({
      success: false,
      error:
        "Only super admins may manage sales agent suburb assignments. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or super_admin / admin.",
    });
    return;
  }
  next();
}

function authExtras(res: Response) {
  const auth = res.locals.supabaseAuth;
  if (!auth) return {};
  return {
    access: "super-admin" as const,
    authenticatedAs: sessionSummaryFromLocals({
      user: auth.user,
      roles: auth.roles,
    }),
  };
}

function parseListFilters(
  query: Record<string, unknown>
): SalesAgentSuburbAssignmentListFilters {
  const filters: SalesAgentSuburbAssignmentListFilters = {};
  const tenantId = queryString(query.tenantId) ?? queryString(query.tenant_id);
  const agentId = queryString(query.agentId) ?? queryString(query.agent_id);
  const suburb = queryString(query.suburb);
  const search = queryString(query.search);
  const limit = queryInt(query.limit);
  const offset = queryInt(query.offset);

  if (tenantId) filters.tenantId = tenantId;
  if (agentId) filters.agentId = agentId;
  if (suburb) filters.suburb = suburb;
  if (search) filters.search = search;
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  return filters;
}

function errorStatus(e: unknown, fallback = 500): number {
  if (
    e instanceof Error &&
    "statusCode" in e &&
    typeof (e as Error & { statusCode?: number }).statusCode === "number"
  ) {
    return (e as Error & { statusCode: number }).statusCode;
  }

  const msg = e instanceof Error ? e.message : "";
  if (
    msg.includes("required") ||
    msg.includes("cannot be empty") ||
    msg.includes("Provide at least one field")
  ) {
    return 400;
  }

  return fallback;
}

/**
 * GET /api/sales-agent-suburb-assignments
 * Query: tenantId, agentId, suburb, search, limit, offset
 */
router.get("/", async (req, res) => {
  try {
    const result = await listSalesAgentSuburbAssignments(
      parseListFilters(req.query as Record<string, unknown>)
    );
    res.json({
      success: true,
      ...result,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to list sales agent suburb assignments";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales-agent-suburb-assignments/:id
 */
router.get("/:id", async (req, res) => {
  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    const row = await getSalesAgentSuburbAssignmentById(id);
    if (!row) {
      res.status(404).json({
        success: false,
        error: "Sales agent suburb assignment not found.",
      });
      return;
    }
    res.json({
      success: true,
      data: row,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to load sales agent suburb assignment";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/sales-agent-suburb-assignments
 * Body: { tenantId, agentId, suburb }
 */
router.post("/", async (req, res) => {
  try {
    const data = await createSalesAgentSuburbAssignment(
      req.body as SalesAgentSuburbAssignmentInput
    );
    res.status(201).json({
      success: true,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to create sales agent suburb assignment";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/sales-agent-suburb-assignments/:id
 * Body: one or more of tenantId, agentId, suburb.
 */
router.patch("/:id", async (req, res) => {
  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    const data = await updateSalesAgentSuburbAssignment(
      id,
      req.body as SalesAgentSuburbAssignmentUpdateInput
    );
    res.json({
      success: true,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to update sales agent suburb assignment";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/sales-agent-suburb-assignments/:id
 */
router.delete("/:id", async (req, res) => {
  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    const data = await deleteSalesAgentSuburbAssignment(id);
    res.json({
      success: true,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to delete sales agent suburb assignment";
    res.status(errorStatus(e)).json({ success: false, error: msg });
  }
});

export default router;
