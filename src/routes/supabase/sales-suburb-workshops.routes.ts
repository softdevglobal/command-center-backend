import { Router, type NextFunction, type Request, type Response } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  createSalesSuburbWorkshop,
  deleteSalesSuburbWorkshop,
  getSalesSuburbWorkshopById,
  listSalesSuburbWorkshops,
  updateSalesSuburbWorkshop,
} from "../../services/sales-suburb-workshops.service.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import type {
  SalesSuburbWorkshopInput,
  SalesSuburbWorkshopListFilters,
  SalesSuburbWorkshopUpdateInput,
} from "../../types/sales-suburb-workshop.types.js";

const router = Router();

router.use(attachSupabaseUser);
router.use(requireSalesSuburbWorkshopSuperAdmin);

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

function requireSalesSuburbWorkshopSuperAdmin(
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
        "Only super admins may manage sales suburb workshops. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or super_admin / admin.",
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

function parseListFilters(query: Record<string, unknown>): SalesSuburbWorkshopListFilters {
  const filters: SalesSuburbWorkshopListFilters = {};
  const tenantId = queryString(query.tenantId) ?? queryString(query.tenant_id);
  const suburb = queryString(query.suburb);
  const search = queryString(query.search);
  const limit = queryInt(query.limit);
  const offset = queryInt(query.offset);

  if (tenantId) filters.tenantId = tenantId;
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
    msg.includes("non-empty") ||
    msg.includes("cannot be empty") ||
    msg.includes("Provide at least one field")
  ) {
    return 400;
  }

  return fallback;
}

/**
 * GET /api/sales-suburb-workshops
 * Query: tenantId, suburb, search, limit, offset
 */
router.get("/", async (req, res) => {
  try {
    const result = await listSalesSuburbWorkshops(
      parseListFilters(req.query as Record<string, unknown>)
    );
    res.json({
      success: true,
      ...result,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to list sales suburb workshops";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales-suburb-workshops/:id
 */
router.get("/:id", async (req, res) => {
  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    const row = await getSalesSuburbWorkshopById(id);
    if (!row) {
      res
        .status(404)
        .json({ success: false, error: "Sales suburb workshop not found." });
      return;
    }
    res.json({
      success: true,
      data: row,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to load sales suburb workshop";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/sales-suburb-workshops
 * Body: { tenantId, suburb, workshopName?, phoneNumber?, ownerName?, ownerEmail?, location?, website? }
 */
router.post("/", async (req, res) => {
  try {
    const data = await createSalesSuburbWorkshop(
      req.body as SalesSuburbWorkshopInput
    );
    res.status(201).json({
      success: true,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to create sales suburb workshop";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/sales-suburb-workshops/:id
 * Body: one or more of tenantId, suburb, workshopName, phoneNumber, ownerName, ownerEmail, location, website.
 */
router.patch("/:id", async (req, res) => {
  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    const data = await updateSalesSuburbWorkshop(
      id,
      req.body as SalesSuburbWorkshopUpdateInput
    );
    res.json({
      success: true,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to update sales suburb workshop";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/sales-suburb-workshops/:id
 */
router.delete("/:id", async (req, res) => {
  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    const data = await deleteSalesSuburbWorkshop(id);
    res.json({
      success: true,
      data,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to delete sales suburb workshop";
    res.status(errorStatus(e)).json({ success: false, error: msg });
  }
});

export default router;
