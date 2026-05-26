import { Router, type NextFunction, type Request, type Response } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  agentMayCreateSalesSuburbWorkshop,
  agentMayViewSalesSuburbWorkshop,
  createSalesSuburbWorkshop,
  deleteSalesSuburbWorkshop,
  getSalesSuburbWorkshopById,
  listAssignedSalesSuburbWorkshops,
  listSalesSuburbWorkshops,
  updateSalesSuburbWorkshop,
} from "../../services/sales-suburb-workshops.service.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import { resolveAgentIdForUserViaSupabase } from "../../services/shared/agent-chat.pipeline.js";
import type {
  SalesSuburbWorkshopInput,
  SalesSuburbWorkshopListFilters,
  SalesSuburbWorkshopUpdateInput,
} from "../../types/sales-suburb-workshop.types.js";

const router = Router();
const SALES_WORKSHOP_TENANT_ID = "t-1775956177847";

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
        "Only super admins may edit or delete sales suburb workshops. Agents may create workshops only for assigned suburbs.",
    });
    return;
  }
  next();
}

function isSuperAdmin(roles: string[]): boolean {
  return roles.some((r) => roleMayRegisterAgents(r));
}

function isAgent(roles: string[]): boolean {
  return roles.includes("agent");
}

type SalesSuburbWorkshopAccess =
  | { kind: "super-admin"; agentId: string | null }
  | { kind: "agent"; agentId: string };

async function resolveSalesSuburbWorkshopAccess(
  roles: string[],
  userId: string
): Promise<SalesSuburbWorkshopAccess | { error: string; status: number }> {
  const linkedAgentId = await resolveAgentIdForUserViaSupabase({ userId });

  if (isSuperAdmin(roles)) {
    return { kind: "super-admin", agentId: linkedAgentId };
  }

  if (!isAgent(roles)) {
    return {
      status: 403,
      error:
        "Only super admins or agents may access sales suburb workshops. Sign in with an account that has the appropriate user_roles entry.",
    };
  }

  if (!linkedAgentId) {
    return {
      status: 403,
      error:
        "No agent record linked to this user. Ensure agents.user_id matches your Supabase Auth user id.",
    };
  }

  return { kind: "agent", agentId: linkedAgentId };
}

function authExtras(res: Response, access?: SalesSuburbWorkshopAccess) {
  const auth = res.locals.supabaseAuth;
  if (!auth) return {};
  return {
    ...(access ? { access: access.kind } : {}),
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

function bodyString(
  body: Record<string, unknown>,
  camel: string,
  snake: string
): string {
  const value = body[camel] ?? body[snake];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * GET /api/sales-suburb-workshops
 * Query: tenantId, suburb, search, limit, offset
 */
router.get("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveSalesSuburbWorkshopAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  try {
    const filters = parseListFilters(req.query as Record<string, unknown>);
    const result =
      access.kind === "agent"
        ? await listAssignedSalesSuburbWorkshops({
            agentId: access.agentId,
            filters,
          })
        : await listSalesSuburbWorkshops(filters);
    res.json({
      success: true,
      ...result,
      ...authExtras(res, access),
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
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveSalesSuburbWorkshopAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

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
    if (
      access.kind === "agent" &&
      !(await agentMayViewSalesSuburbWorkshop({
        agentId: access.agentId,
        row,
      }))
    ) {
      res
        .status(404)
        .json({ success: false, error: "Sales suburb workshop not found." });
      return;
    }
    res.json({
      success: true,
      data: row,
      ...authExtras(res, access),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to load sales suburb workshop";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/sales-suburb-workshops
 * Super admin: any row. Agent: only assigned suburb. tenantId is always fixed by the API.
 * Body: { suburb, workshopName?, phoneNumber?, ownerName?, ownerEmail?, location?, website? }
 */
router.post("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveSalesSuburbWorkshopAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const body = req.body as SalesSuburbWorkshopInput & Record<string, unknown>;
  const tenantId = SALES_WORKSHOP_TENANT_ID;
  const suburb = bodyString(body, "suburb", "suburb");

  if (access.kind === "agent") {
    if (!suburb) {
      res.status(400).json({
        success: false,
        error: "suburb is required.",
      });
      return;
    }

    const allowed = await agentMayCreateSalesSuburbWorkshop({
      agentId: access.agentId,
      tenantId,
      suburb,
    });
    if (!allowed) {
      res.status(403).json({
        success: false,
        error: "Agents may only add workshops for assigned suburbs.",
      });
      return;
    }
  }

  try {
    const createBody: SalesSuburbWorkshopInput = {
      ...body,
      tenantId,
      suburb,
    };
    const data = await createSalesSuburbWorkshop(createBody);
    res.status(201).json({
      success: true,
      data,
      ...authExtras(res, access),
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
router.patch("/:id", requireSalesSuburbWorkshopSuperAdmin, async (req, res) => {
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
      ...authExtras(res, { kind: "super-admin", agentId: null }),
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
router.delete("/:id", requireSalesSuburbWorkshopSuperAdmin, async (req, res) => {
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
      ...authExtras(res, { kind: "super-admin", agentId: null }),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to delete sales suburb workshop";
    res.status(errorStatus(e)).json({ success: false, error: msg });
  }
});

export default router;
