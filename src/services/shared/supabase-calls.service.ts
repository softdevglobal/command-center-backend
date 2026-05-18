import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  CallListFilters,
  CallListResult,
  CallRow,
} from "../../types/call.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Escape `%`, `_`, and `\` for use inside an ILIKE pattern. */
function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: CallListFilters): {
  limit: number;
  offset: number;
} {
  const limitRaw = filters.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT)
  );
  const offsetRaw = filters.offset ?? 0;
  const offset = Math.max(
    0,
    Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0
  );
  return { limit, offset };
}

export async function listCallsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: CallListFilters;
}): Promise<CallListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("calls")
    .select("*", { count: "exact" })
    .order("start_time", { ascending: false });

  const scopeAgentId = input.filters.scopeAgentId?.trim();
  if (scopeAgentId) {
    q = q.eq("agent_id", scopeAgentId).not("answer_time", "is", null);
  }

  const tenantId = input.filters.tenantId?.trim();
  const queueId = input.filters.queueId?.trim();
  const agentId = input.filters.agentId?.trim();
  const callerName = input.filters.callerName?.trim();
  const direction = input.filters.direction;
  const result = input.filters.result?.trim();
  const from = input.filters.from?.trim();
  const to = input.filters.to?.trim();

  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (queueId) q = q.eq("queue_id", queueId);
  if (agentId && !scopeAgentId) q = q.eq("agent_id", agentId);
  if (callerName) {
    q = q.ilike("caller_name", `%${escapeIlikePattern(callerName)}%`);
  }
  if (direction) q = q.eq("direction", direction);
  if (result) q = q.eq("result", result);
  if (from) q = q.gte("start_time", from);
  if (to) q = q.lte("start_time", to);

  const { data, error, count } = await q.range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as CallRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getCallByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<CallRow | null> {
  const key = input.id.trim();
  if (!key) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .eq("id", key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as CallRow | null) ?? null;
}
