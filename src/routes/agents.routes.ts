import { createClient } from "@supabase/supabase-js";
import { Router, type Response } from "express";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";
import {
  authorizeSuperAdminOrSetup,
  type SuperAdminOrSetupAuth,
} from "../middleware/super-admin-or-setup.middleware.js";
import {
  registerAgent,
  registerAgentViaSetupSecret,
} from "../services/agent-register.service.js";
import { sessionSummaryFromLocals } from "../services/auth/supabase-auth.service.js";
import {
  deleteAgentInSupabase,
  getAgentByIdInSupabase,
  getAgentPerformanceInSupabase,
  listAgentsInSupabase,
  updateAgentInSupabase,
} from "../services/shared/supabase-agents.service.js";
import type {
  AgentListFilters,
  AgentPerformanceFilters,
  AgentUpdateInput,
} from "../types/agent-management.types.js";
import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";

const router = Router();

function statusCodeFromError(error: unknown, fallback: number): number {
  if (
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as Error & { statusCode?: number }).statusCode === "number"
  ) {
    return (error as Error & { statusCode: number }).statusCode;
  }
  return fallback;
}

function requireSupabaseConfig(
  res: Response
): { url: string; key: string } | null {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    res.status(500).json({
      error: "Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    });
    return null;
  }
  return { url, key };
}

function authEnvelope(auth: SuperAdminOrSetupAuth): Record<string, unknown> {
  if (auth.kind === "setup-secret") {
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

function singleQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    const trimmed = value[0].trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function numberQueryValue(value: unknown): number | undefined {
  const text = singleQueryValue(value);
  if (!text) return undefined;
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function queryBool(value: unknown): boolean {
  return value === "true" || value === "1";
}

/** `YYYY-MM-DD` to UTC day bounds for calls.start_time filtering. */
function dayBoundsFromDateParam(
  date: string
): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
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

function parseDirectionFilter(
  query: Record<string, unknown>
): AgentPerformanceFilters["direction"] | undefined | { error: string } {
  const raw = singleQueryValue(query.direction)?.toLowerCase();
  const inbound = queryBool(query.inbound);
  const outbound = queryBool(query.outbound);

  if (inbound && outbound) {
    return { error: "Use either inbound or outbound filter, not both." };
  }
  if (raw) {
    if (raw !== "inbound" && raw !== "outbound") {
      return { error: 'direction must be "inbound" or "outbound".' };
    }
    return raw;
  }
  if (inbound) return "inbound";
  if (outbound) return "outbound";
  return undefined;
}

function normalizeAgentTypeFilter(
  value: string | undefined
): AgentListFilters["agentType"] | null {
  if (!value) return undefined;
  if (value === "all" || value === "workshop") return value;
  if (value === "command-centre" || value === "command-center") {
    return "command-centre";
  }
  return null;
}

type ParsePerformanceFiltersResult =
  | { ok: true; filters: AgentPerformanceFilters }
  | { ok: false; error: string };

function parsePerformanceFilters(
  query: Record<string, unknown>
): ParsePerformanceFiltersResult {
  const agentType = normalizeAgentTypeFilter(
    singleQueryValue(query.agentType ?? query.type)
  );
  if (agentType === null) {
    return {
      ok: false,
      error:
        "agentType must be all, command-centre, command-center, or workshop.",
    };
  }

  const direction = parseDirectionFilter(query);
  if (direction && typeof direction === "object" && "error" in direction) {
    return { ok: false, error: direction.error };
  }

  const filters: AgentPerformanceFilters = {};
  if (agentType) filters.agentType = agentType;

  const agentId = singleQueryValue(query.agentId ?? query.agent_id);
  const tenantId = singleQueryValue(query.tenantId);
  const ownerUid = singleQueryValue(query.ownerUid);
  const branchId = singleQueryValue(query.branchId);
  const queueId = singleQueryValue(query.queueId);
  const role = singleQueryValue(query.role);
  const status = singleQueryValue(query.status);
  const search = singleQueryValue(query.search);
  const limit = numberQueryValue(query.limit);
  const offset = numberQueryValue(query.offset);
  const from = singleQueryValue(query.from);
  const to = singleQueryValue(query.to);
  const date = singleQueryValue(query.date);

  if (agentId) filters.agentId = agentId;
  if (tenantId) filters.tenantId = tenantId;
  if (ownerUid) filters.ownerUid = ownerUid;
  if (branchId) filters.branchId = branchId;
  if (queueId) filters.queueId = queueId;
  if (role) filters.role = role;
  if (status) filters.status = status;
  if (search) filters.search = search;
  if (direction && typeof direction === "string") filters.direction = direction;
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  if (date) {
    const bounds = dayBoundsFromDateParam(date);
    if (!bounds) {
      return {
        ok: false,
        error:
          "date must be a valid calendar day in YYYY-MM-DD format (e.g. 2026-05-16).",
      };
    }
    filters.from = from ?? bounds.from;
    filters.to = to ?? bounds.to;
  } else {
    if (from) filters.from = from;
    if (to) filters.to = to;
  }

  return { ok: true, filters };
}

function agentIdFromParams(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) return raw[0]?.trim() ?? "";
  return "";
}

async function authorizeAgentsManagementRequest(
  req: Parameters<typeof authorizeSuperAdminOrSetup>[0],
  res: Response
): Promise<SuperAdminOrSetupAuth | null> {
  return authorizeSuperAdminOrSetup(req, res, {
    forbiddenMessage:
      "Only super admins may manage command center and workshop agents.",
  });
}

/**
 * GET /api/agents
 * Super admin list of command center and workshop agents.
 * Optional query: agentType=all|command-centre|command-center|workshop, tenantId, ownerUid, branchId, role, status, search, limit, offset
 */
router.get("/", async (req, res) => {
  const auth = await authorizeAgentsManagementRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const agentType = normalizeAgentTypeFilter(
    singleQueryValue(req.query.agentType ?? req.query.type)
  );
  if (agentType === null) {
    res.status(400).json({
      success: false,
      error:
        "agentType must be all, command-centre, command-center, or workshop.",
    });
    return;
  }

  const filters: AgentListFilters = {};
  if (agentType) filters.agentType = agentType;

  const tenantId = singleQueryValue(req.query.tenantId);
  const ownerUid = singleQueryValue(req.query.ownerUid);
  const branchId = singleQueryValue(req.query.branchId);
  const role = singleQueryValue(req.query.role);
  const status = singleQueryValue(req.query.status);
  const search = singleQueryValue(req.query.search);
  const limit = numberQueryValue(req.query.limit);
  const offset = numberQueryValue(req.query.offset);

  if (tenantId) filters.tenantId = tenantId;
  if (ownerUid) filters.ownerUid = ownerUid;
  if (branchId) filters.branchId = branchId;
  if (role) filters.role = role;
  if (status) filters.status = status;
  if (search) filters.search = search;
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  try {
    const data = await listAgentsInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      filters,
    });
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list agents";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agents/performance
 * Super admin performance summary from `agents` + `calls`.
 * Optional query: agentId, agentType, tenantId, ownerUid, branchId, queueId, role, status, search, direction|inbound|outbound, date|from|to, limit, offset
 */
router.get("/performance", async (req, res) => {
  const auth = await authorizeAgentsManagementRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const parsed = parsePerformanceFilters(req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const data = await getAgentPerformanceInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      filters: parsed.filters,
    });
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to load agent performance";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agents/:id
 * Super admin view for one command center or workshop agent.
 */
router.get("/:id", async (req, res) => {
  const auth = await authorizeAgentsManagementRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const agentId = agentIdFromParams(req.params.id);
  if (!agentId) {
    res.status(400).json({ success: false, error: "Agent id is required." });
    return;
  }

  try {
    const data = await getAgentByIdInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      agentId,
    });
    if (!data) {
      res.status(404).json({ success: false, error: "Agent not found." });
      return;
    }
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load agent";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PATCH /api/agents/:id
 * Body: editable `agents` fields. Use agentType=command-centre to clear workshop fields.
 */
router.patch("/:id", async (req, res) => {
  const auth = await authorizeAgentsManagementRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const agentId = agentIdFromParams(req.params.id);
  if (!agentId) {
    res.status(400).json({ success: false, error: "Agent id is required." });
    return;
  }

  try {
    const data = await updateAgentInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      agentId,
      body: req.body as AgentUpdateInput,
    });
    if (!data) {
      res.status(404).json({ success: false, error: "Agent not found." });
      return;
    }
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update agent";
    res
      .status(statusCodeFromError(e, 400))
      .json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/agents/:id
 * Deletes the agents row, then best-effort cleans up linked user_roles and Supabase Auth user.
 */
router.delete("/:id", async (req, res) => {
  const auth = await authorizeAgentsManagementRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const agentId = agentIdFromParams(req.params.id);
  if (!agentId) {
    res.status(400).json({ success: false, error: "Agent id is required." });
    return;
  }

  try {
    const data = await deleteAgentInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      agentId,
    });
    if (!data) {
      res.status(404).json({ success: false, error: "Agent not found." });
      return;
    }
    res.json({ success: true, data, ...authEnvelope(auth) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete agent";
    res
      .status(statusCodeFromError(e, 500))
      .json({ success: false, error: msg });
  }
});

/**
 * POST /api/agents/register
 *
 * **Production:** `Authorization: Bearer <access_token>` from `POST /api/auth/login` as a user whose
 * `user_roles` allows agent registration (super admin / configured role).
 *
 * **Local / Postman (no login):** header `x-setup-secret: <SETUP_SECRET_KEY>` (same secret as
 * `POST /api/super-admin/register`). Uses Supabase service role on Command Center — does not call BMS Black HTTP.
 *
 * Body: name, email, phone, password, extension (required); notes?, agentType?, tenantId?,
 * workshopOwnerUid?, workshopBranchId?, workshopUserRole? for workshop agents.
 *
 * Creates Supabase agent + Firebase Black + Firebase Pink (same password) where Admin SDK is configured on CC.
 */
router.post("/register", async (req, res) => {
  const body = req.body as CreateAgentRequestBody;

  if (
    !body?.name ||
    !body?.email ||
    !body?.password ||
    body.phone === undefined
  ) {
    res.status(400).json({
      error: "name, email, phone, and password are required",
    });
    return;
  }

  const secret = req.headers["x-setup-secret"];
  const setupExpected = process.env.SETUP_SECRET_KEY?.trim();
  if (setupExpected && secret === setupExpected) {
    try {
      const result = await registerAgentViaSetupSecret(body);
      res.status(200).json({
        success: true,
        authMode: "x-setup-secret",
        supabase: {
          userId: result.userId,
          agentId: result.agentId,
        },
        firebaseBlack: { uid: result.firebaseBlackUid },
        firebasePink: { uid: result.firebasePinkUid },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      res.status(400).json({ success: false, error: msg });
    }
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const supabaseBearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!supabaseBearer) {
    res.status(401).json({
      error:
        "Missing auth: send Authorization: Bearer <Supabase access_token> from POST /api/auth/login (super admin), OR header x-setup-secret matching SETUP_SECRET_KEY for local bootstrap (same secret as POST /api/super-admin/register).",
    });
    return;
  }

  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    res.status(500).json({
      error: "Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    });
    return;
  }

  try {
    const admin = createClient(url, key);
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(supabaseBearer);

    if (userErr || !user) {
      res.status(401).json({
        error: userErr?.message ?? "Invalid or expired Supabase session.",
      });
      return;
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (roleRows ?? [])
      .map((row: { role: string }) => row.role)
      .filter(Boolean);

    if (!roles.some((r) => roleMayRegisterAgents(r))) {
      res.status(403).json({
        error:
          "Only super admins can register agents. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or super_admin / admin.",
      });
      return;
    }

    const result = await registerAgent(body, { supabaseBearer });

    res.status(200).json({
      success: true,
      authMode: "bearer",
      authenticatedAs: sessionSummaryFromLocals({ user, roles }),
      supabase: {
        userId: result.userId,
        agentId: result.agentId,
      },
      firebaseBlack: {
        uid: result.firebaseBlackUid,
      },
      firebasePink: {
        uid: result.firebasePinkUid,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Registration failed";
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
