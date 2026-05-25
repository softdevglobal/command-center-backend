import { Router, type NextFunction, type Request, type Response } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  createSalesSuburbWorkshopAgentContact,
  deleteSalesSuburbWorkshopAgentContact,
  getSalesSuburbWorkshopAgentContactById,
  getSalesSuburbWorkshopAgentContactByPair,
  listSalesSuburbWorkshopAgentContacts,
  updateSalesSuburbWorkshopAgentContact,
} from "../../services/sales-suburb-workshop-agent-contacts.service.js";
import {
  agentMayViewSalesSuburbWorkshop,
  getSalesSuburbWorkshopById,
} from "../../services/sales-suburb-workshops.service.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import { resolveAgentIdForUserViaSupabase } from "../../services/shared/agent-chat.pipeline.js";
import type {
  SalesSuburbWorkshopAgentContactInput,
  SalesSuburbWorkshopAgentContactListFilters,
  SalesSuburbWorkshopAgentContactRow,
  SalesSuburbWorkshopAgentContactUpdateInput,
} from "../../types/sales-suburb-workshop-agent-contact.types.js";
import type { SalesSuburbWorkshopRow } from "../../types/sales-suburb-workshop.types.js";

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

type ContactAccess =
  | { kind: "super-admin"; agentId: string | null }
  | { kind: "agent"; agentId: string };

async function resolveContactAccess(
  roles: string[],
  userId: string
): Promise<ContactAccess | { error: string; status: number }> {
  const linkedAgentId = await resolveAgentIdForUserViaSupabase({ userId });

  if (isSuperAdmin(roles)) {
    return { kind: "super-admin", agentId: linkedAgentId };
  }

  if (!isAgent(roles)) {
    return {
      status: 403,
      error:
        "Only super admins or agents may access workshop agent contacts. Sign in with an account that has the appropriate user_roles entry.",
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

function requireContactSuperAdmin(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const auth = res.locals.supabaseAuth;
  const roles = auth?.roles ?? [];
  if (!isSuperAdmin(roles)) {
    res.status(403).json({
      success: false,
      error: "Only super admins may delete workshop agent contacts.",
    });
    return;
  }
  next();
}

function authExtras(res: Response, access?: ContactAccess) {
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

function parseListFilters(
  query: Record<string, unknown>
): SalesSuburbWorkshopAgentContactListFilters {
  const filters: SalesSuburbWorkshopAgentContactListFilters = {};
  const tenantId = queryString(query.tenantId) ?? queryString(query.tenant_id);
  const workshopId =
    queryString(query.workshopId) ?? queryString(query.workshop_id);
  const agentId = queryString(query.agentId) ?? queryString(query.agent_id);
  const callStatus =
    queryString(query.callStatus) ?? queryString(query.call_status);
  const from = queryString(query.from);
  const to = queryString(query.to);
  const limit = queryInt(query.limit);
  const offset = queryInt(query.offset);

  if (tenantId) filters.tenantId = tenantId;
  if (workshopId) filters.workshopId = workshopId;
  if (agentId) filters.agentId = agentId;
  if (callStatus) filters.callStatus = callStatus;
  if (from) filters.from = from;
  if (to) filters.to = to;
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
    msg.includes("Provide at least one field") ||
    msg.includes("timestamp")
  ) {
    return 400;
  }

  return fallback;
}

function validateTimestamp(value: string | null | undefined, field: string): string | null {
  if (value == null || value === "") return null;
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid ISO 8601 timestamp.`);
  }
  return value;
}

function bodyString(body: Record<string, unknown>, camel: string, snake: string): string {
  const value = body[camel] ?? body[snake];
  return typeof value === "string" ? value.trim() : "";
}

async function loadWorkshopOrError(
  workshopId: string
): Promise<SalesSuburbWorkshopRow | { error: string; status: number }> {
  const workshop = await getSalesSuburbWorkshopById(workshopId);
  if (!workshop) {
    return { status: 404, error: "Sales suburb workshop not found." };
  }
  return workshop;
}

async function agentMayUseWorkshop(input: {
  access: ContactAccess;
  workshop: SalesSuburbWorkshopRow;
}): Promise<boolean> {
  if (input.access.kind === "super-admin") return true;
  return agentMayViewSalesSuburbWorkshop({
    agentId: input.access.agentId,
    row: input.workshop,
  });
}

function agentMayViewContact(
  access: ContactAccess,
  row: SalesSuburbWorkshopAgentContactRow
): boolean {
  return access.kind === "super-admin" || row.agent_id === access.agentId;
}

function sanitizeAgentUpdateBody(
  body: SalesSuburbWorkshopAgentContactUpdateInput
): SalesSuburbWorkshopAgentContactUpdateInput {
  const patch: SalesSuburbWorkshopAgentContactUpdateInput = {};
  const source = body as SalesSuburbWorkshopAgentContactUpdateInput & {
    call_status?: string | null;
    first_called_at?: string | null;
    follow_up_at?: string | null;
  };

  const callStatus = body.callStatus ?? source.call_status;
  if (callStatus !== undefined) patch.callStatus = callStatus;

  const firstCalledAt = body.firstCalledAt ?? source.first_called_at;
  if (firstCalledAt !== undefined) patch.firstCalledAt = firstCalledAt;

  const followUpAt = body.followUpAt ?? source.follow_up_at;
  if (followUpAt !== undefined) patch.followUpAt = followUpAt;

  if (body.remarks !== undefined) patch.remarks = body.remarks;

  return patch;
}

/**
 * GET /api/sales-suburb-workshop-agent-contacts
 * Super admin: all rows. Agent: own rows only.
 */
router.get("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveContactAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  try {
    const filters = parseListFilters(req.query as Record<string, unknown>);
    if (access.kind === "agent") {
      filters.agentId = access.agentId;
    }
    const result = await listSalesSuburbWorkshopAgentContacts(filters);
    res.json({
      success: true,
      ...result,
      ...authExtras(res, access),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to list sales suburb workshop agent contacts";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales-suburb-workshop-agent-contacts/workshops/:workshopId
 * Returns the current agent's row for a workshop; super admin can pass ?agentId=.
 */
router.get("/workshops/:workshopId", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveContactAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const workshopId = paramId(req.params.workshopId).trim();
  if (!workshopId) {
    res.status(400).json({ success: false, error: "workshopId is required." });
    return;
  }

  const agentId =
    access.kind === "agent"
      ? access.agentId
      : queryString(req.query.agentId) ?? queryString(req.query.agent_id);
  if (!agentId) {
    res.status(400).json({
      success: false,
      error: "agentId is required for super admin workshop contact lookup.",
    });
    return;
  }

  try {
    const row = await getSalesSuburbWorkshopAgentContactByPair({
      workshopId,
      agentId,
    });
    if (!row) {
      res.status(404).json({
        success: false,
        error: "Sales suburb workshop agent contact not found.",
      });
      return;
    }
    res.json({ success: true, data: row, ...authExtras(res, access) });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to load sales suburb workshop agent contact";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/sales-suburb-workshop-agent-contacts/:id
 */
router.get("/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveContactAccess(auth.roles, auth.user.id);
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
    const row = await getSalesSuburbWorkshopAgentContactById(id);
    if (!row || !agentMayViewContact(access, row)) {
      res.status(404).json({
        success: false,
        error: "Sales suburb workshop agent contact not found.",
      });
      return;
    }
    res.json({ success: true, data: row, ...authExtras(res, access) });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to load sales suburb workshop agent contact";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/sales-suburb-workshop-agent-contacts
 * Body: { workshopId, agentId?, callStatus?, firstCalledAt?, followUpAt?, remarks? }
 */
router.post("/", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveContactAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const body = req.body as SalesSuburbWorkshopAgentContactInput &
    Record<string, unknown>;
  const workshopId = bodyString(body, "workshopId", "workshop_id");
  if (!workshopId) {
    res.status(400).json({ success: false, error: "workshopId is required." });
    return;
  }

  const workshop = await loadWorkshopOrError(workshopId);
  if ("error" in workshop) {
    res.status(workshop.status).json({ success: false, error: workshop.error });
    return;
  }
  if (!(await agentMayUseWorkshop({ access, workshop }))) {
    res.status(403).json({
      success: false,
      error: "Agents may only create contacts for assigned workshops.",
    });
    return;
  }

  const targetAgentId =
    access.kind === "agent" ? access.agentId : bodyString(body, "agentId", "agent_id");
  if (!targetAgentId) {
    res.status(400).json({ success: false, error: "agentId is required." });
    return;
  }

  try {
    const input: SalesSuburbWorkshopAgentContactInput = {
      ...body,
      tenantId: workshop.tenant_id,
      workshopId: workshop.id,
      agentId: targetAgentId,
      firstCalledAt: validateTimestamp(body.firstCalledAt, "firstCalledAt"),
      followUpAt: validateTimestamp(body.followUpAt, "followUpAt"),
    };
    const data = await createSalesSuburbWorkshopAgentContact(input);
    res.status(201).json({
      success: true,
      data,
      ...authExtras(res, access),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to create sales suburb workshop agent contact";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/sales-suburb-workshop-agent-contacts/:id
 * Agents may update only their own call fields.
 */
router.patch("/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveContactAccess(auth.roles, auth.user.id);
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
    const existing = await getSalesSuburbWorkshopAgentContactById(id);
    if (!existing || !agentMayViewContact(access, existing)) {
      res.status(404).json({
        success: false,
        error: "Sales suburb workshop agent contact not found.",
      });
      return;
    }

    const rawBody = req.body as SalesSuburbWorkshopAgentContactUpdateInput;
    const patch =
      access.kind === "agent" ? sanitizeAgentUpdateBody(rawBody) : rawBody;

    if (patch.workshopId || (patch as { workshop_id?: string }).workshop_id) {
      const workshopId =
        patch.workshopId ?? (patch as { workshop_id?: string }).workshop_id ?? "";
      const workshop = await loadWorkshopOrError(workshopId);
      if ("error" in workshop) {
        res.status(workshop.status).json({ success: false, error: workshop.error });
        return;
      }
      patch.tenantId = workshop.tenant_id;
      patch.workshopId = workshop.id;
    }

    if (patch.firstCalledAt !== undefined) {
      patch.firstCalledAt = validateTimestamp(patch.firstCalledAt, "firstCalledAt");
    }
    if (patch.followUpAt !== undefined) {
      patch.followUpAt = validateTimestamp(patch.followUpAt, "followUpAt");
    }

    const data = await updateSalesSuburbWorkshopAgentContact(id, patch);
    res.json({ success: true, data, ...authExtras(res, access) });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to update sales suburb workshop agent contact";
    res.status(errorStatus(e, 400)).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/sales-suburb-workshop-agent-contacts/:id
 * Super admin only.
 */
router.delete("/:id", requireContactSuperAdmin, async (req, res) => {
  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    const data = await deleteSalesSuburbWorkshopAgentContact(id);
    res.json({
      success: true,
      data,
      ...authExtras(res, { kind: "super-admin", agentId: null }),
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Failed to delete sales suburb workshop agent contact";
    res.status(errorStatus(e)).json({ success: false, error: msg });
  }
});

export default router;
