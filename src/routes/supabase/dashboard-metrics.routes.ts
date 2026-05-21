import { Router, type Request, type Response } from "express";

import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import {
  authorizeSuperAdminOrSetup,
  type SuperAdminOrSetupAuth,
} from "../../middleware/super-admin-or-setup.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import {
  getDashboardCallMetricsInSupabase,
  getDashboardMetricsInSupabase,
  getOnlineAgentsCountInSupabase,
} from "../../services/shared/supabase-dashboard-metrics.service.js";
import type {
  CallDirection,
  CallMetricsFilters,
  DashboardMetricsFilters,
  OnlineAgentsCountFilters,
} from "../../types/call.types.js";

const router = Router();
const DEFAULT_ONLINE_STATUSES = ["online"];
const DEFAULT_SLA_SECONDS = 20;

function requireSupabaseConfig(
  res: Response
): { url: string; key: string } | null {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    res.status(500).json({
      success: false,
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

function queryStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => queryStrings(item));
  }
  return [];
}

function queryString(value: unknown): string | undefined {
  return queryStrings(value)[0];
}

function queryNumber(value: unknown): number | undefined {
  const text = queryString(value);
  if (!text) return undefined;
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function utcDayBounds(date: Date): { from: string; to: string } {
  const start = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const end = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23,
    59,
    59,
    999
  );
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  };
}

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
  return utcDayBounds(start);
}

function parseDateRange(
  query: Record<string, unknown>
): { from: string; to: string } | { error: string } {
  const date = queryString(query.date);
  const from = queryString(query.from);
  const to = queryString(query.to);

  if (date) {
    const bounds = dayBoundsFromDateParam(date);
    if (!bounds) {
      return {
        error:
          "date must be a valid calendar day in YYYY-MM-DD format (e.g. 2026-05-16).",
      };
    }
    const result = { from: from ?? bounds.from, to: to ?? bounds.to };
    if (
      !Number.isFinite(Date.parse(result.from)) ||
      !Number.isFinite(Date.parse(result.to))
    ) {
      return { error: "from and to must be valid ISO 8601 timestamps." };
    }
    if (Date.parse(result.from) > Date.parse(result.to)) {
      return { error: "from must be on or before to." };
    }
    return result;
  }

  if (from || to) {
    if (!from || !to) {
      return { error: "from and to must be provided together." };
    }
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) {
      return { error: "from and to must be valid ISO 8601 timestamps." };
    }
    if (Date.parse(from) > Date.parse(to)) {
      return { error: "from must be on or before to." };
    }
    return { from, to };
  }

  return utcDayBounds(new Date());
}

function parseDirection(
  query: Record<string, unknown>
): CallDirection | undefined | { error: string } {
  const raw = queryString(query.direction)?.toLowerCase();
  if (!raw) return undefined;
  if (raw !== "inbound" && raw !== "outbound") {
    return { error: 'direction must be "inbound" or "outbound".' };
  }
  return raw;
}

function parseAgentType(
  value: unknown
): OnlineAgentsCountFilters["agentType"] | { error: string } | undefined {
  const raw = queryString(value)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === "all" || raw === "workshop") return raw;
  if (raw === "command-centre" || raw === "command-center") {
    return "command-centre";
  }
  return {
    error: "agentType must be all, command-centre, command-center, or workshop.",
  };
}

type ParseFiltersResult =
  | { ok: true; filters: DashboardMetricsFilters }
  | { ok: false; error: string };

function parseDashboardFilters(query: Record<string, unknown>): ParseFiltersResult {
  const range = parseDateRange(query);
  if ("error" in range) return { ok: false, error: range.error };

  const direction = parseDirection(query);
  if (direction && typeof direction === "object") {
    return { ok: false, error: direction.error };
  }

  const agentType = parseAgentType(query.agentType ?? query.type);
  if (agentType && typeof agentType === "object") {
    return { ok: false, error: agentType.error };
  }

  const slaSeconds = queryNumber(query.slaSeconds ?? query.sla_seconds);
  if (slaSeconds !== undefined && slaSeconds <= 0) {
    return { ok: false, error: "slaSeconds must be greater than 0." };
  }

  const onlineStatuses =
    queryStrings(query.onlineStatus).length > 0
      ? queryStrings(query.onlineStatus)
      : queryStrings(query.onlineStatuses).length > 0
        ? queryStrings(query.onlineStatuses)
        : DEFAULT_ONLINE_STATUSES;

  const tenantId = queryString(query.tenantId);
  const queueId = queryString(query.queueId);
  const agentId = queryString(query.agentId ?? query.agent_id);
  const ownerUid = queryString(query.ownerUid);
  const branchId = queryString(query.branchId);
  const role = queryString(query.role);

  const filters: DashboardMetricsFilters = {
    from: range.from,
    to: range.to,
    slaSeconds: slaSeconds ?? DEFAULT_SLA_SECONDS,
    onlineStatuses,
  };

  if (tenantId) filters.tenantId = tenantId;
  if (queueId) filters.queueId = queueId;
  if (agentId) filters.agentId = agentId;
  if (ownerUid) filters.ownerUid = ownerUid;
  if (branchId) filters.branchId = branchId;
  if (role) filters.role = role;
  if (direction && typeof direction === "string") filters.direction = direction;
  if (agentType && typeof agentType === "string") filters.agentType = agentType;

  return { ok: true, filters };
}

function callFilters(filters: DashboardMetricsFilters): CallMetricsFilters {
  const result: CallMetricsFilters = {
    from: filters.from,
    to: filters.to,
    slaSeconds: filters.slaSeconds,
  };
  if (filters.tenantId) result.tenantId = filters.tenantId;
  if (filters.queueId) result.queueId = filters.queueId;
  if (filters.agentId) result.agentId = filters.agentId;
  if (filters.direction) result.direction = filters.direction;
  return result;
}

function onlineFilters(filters: DashboardMetricsFilters): OnlineAgentsCountFilters {
  const result: OnlineAgentsCountFilters = {
    onlineStatuses: filters.onlineStatuses,
  };
  if (filters.tenantId) result.tenantId = filters.tenantId;
  if (filters.queueId) result.queueId = filters.queueId;
  if (filters.ownerUid) result.ownerUid = filters.ownerUid;
  if (filters.branchId) result.branchId = filters.branchId;
  if (filters.role) result.role = filters.role;
  if (filters.agentType) result.agentType = filters.agentType;
  return result;
}

function filtersApplied(filters: DashboardMetricsFilters): Record<string, unknown> {
  return {
    from: filters.from,
    to: filters.to,
    slaSeconds: filters.slaSeconds,
    onlineStatuses: filters.onlineStatuses,
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.queueId ? { queueId: filters.queueId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.ownerUid ? { ownerUid: filters.ownerUid } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.agentType ? { agentType: filters.agentType } : {}),
  };
}

async function authorizeMetricsRequest(
  req: Parameters<typeof authorizeSuperAdminOrSetup>[0],
  res: Response
): Promise<SuperAdminOrSetupAuth | null> {
  return authorizeSuperAdminOrSetup(req, res, {
    forbiddenMessage: "Only super admins may view dashboard metrics.",
  });
}

/**
 * GET /api/dashboard/metrics
 * Returns all dashboard KPIs. Defaults to today's UTC calls and `online` agents.
 */
router.get("/metrics", async (req, res) => {
  const auth = await authorizeMetricsRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const parsed = parseDashboardFilters(req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const data = await getDashboardMetricsInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      filters: parsed.filters,
    });
    res.json({
      success: true,
      data,
      filters_applied: filtersApplied(parsed.filters),
      ...authEnvelope(auth),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load dashboard metrics";
    res.status(500).json({ success: false, error: msg });
  }
});

router.get("/online-agents-count", async (req, res) => {
  const auth = await authorizeMetricsRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const parsed = parseDashboardFilters(req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const onlineAgentsCount = await getOnlineAgentsCountInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      filters: onlineFilters(parsed.filters),
    });
    res.json({
      success: true,
      data: { online_agents_count: onlineAgentsCount },
      filters_applied: filtersApplied(parsed.filters),
      ...authEnvelope(auth),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load online agents count";
    res.status(500).json({ success: false, error: msg });
  }
});

async function sendCallMetric(
  req: Request,
  res: Response,
  key:
    | "today_calls_count"
    | "answer_rate_percent"
    | "abandon_rate_percent"
    | "average_handle_seconds"
    | "sla_percent"
): Promise<void> {
  const auth = await authorizeMetricsRequest(req, res);
  if (!auth) return;
  const config = requireSupabaseConfig(res);
  if (!config) return;

  const parsed = parseDashboardFilters(req.query);
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const metrics = await getDashboardCallMetricsInSupabase({
      supabaseUrl: config.url,
      serviceRoleKey: config.key,
      filters: callFilters(parsed.filters),
    });
    res.json({
      success: true,
      data: { [key]: metrics[key] },
      filters_applied: filtersApplied(parsed.filters),
      ...authEnvelope(auth),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : `Failed to load ${key}`;
    res.status(500).json({ success: false, error: msg });
  }
}

router.get("/today-calls-count", (req, res) =>
  sendCallMetric(req, res, "today_calls_count")
);
router.get("/answer-rate", (req, res) =>
  sendCallMetric(req, res, "answer_rate_percent")
);
router.get("/abandon-rate", (req, res) =>
  sendCallMetric(req, res, "abandon_rate_percent")
);
router.get("/abondon-rate", (req, res) =>
  sendCallMetric(req, res, "abandon_rate_percent")
);
router.get("/avg-handle", (req, res) =>
  sendCallMetric(req, res, "average_handle_seconds")
);
router.get("/sla", (req, res) => sendCallMetric(req, res, "sla_percent"));

export default router;
