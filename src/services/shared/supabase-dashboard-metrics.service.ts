import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import type {
  CallMetricsFilters,
  DashboardCallMetrics,
  DashboardMetricsFilters,
  DashboardMetricsResult,
  OnlineAgentsCountFilters,
} from "../../types/call.types.js";

const CALLS_PAGE_SIZE = 1000;

type MetricCallRow = {
  start_time: string;
  answer_time: string | null;
  end_time: string | null;
  duration_seconds: number | null;
};

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createSupabaseClient(supabaseUrl, serviceRoleKey);
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
}

function normalizedStatuses(statuses: string[]): string[] {
  return [...new Set(statuses.map((s) => s.trim()).filter(Boolean))];
}

export async function getOnlineAgentsCountInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: OnlineAgentsCountFilters;
}): Promise<number> {
  const statuses = normalizedStatuses(input.filters.onlineStatuses);
  if (statuses.length === 0) return 0;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  let q = supabase
    .from("agents")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);

  if (input.filters.agentType === "workshop") {
    q = q.or(
      "bms_owner_uid.not.is.null,bms_branch_id.not.is.null,workshop_user_role.not.is.null"
    );
  } else if (input.filters.agentType === "command-centre") {
    q = q
      .is("bms_owner_uid", null)
      .is("bms_branch_id", null)
      .is("workshop_user_role", null);
  }

  const tenantId = input.filters.tenantId?.trim();
  const queueId = input.filters.queueId?.trim();
  const ownerUid = input.filters.ownerUid?.trim();
  const branchId = input.filters.branchId?.trim();
  const role = input.filters.role?.trim();

  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (queueId) q = q.contains("queue_ids", [queueId]);
  if (ownerUid) q = q.eq("bms_owner_uid", ownerUid);
  if (branchId) q = q.eq("bms_branch_id", branchId);
  if (role) q = q.eq("role", role);

  const { error, count } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function fetchCallsForMetrics(input: {
  supabase: SupabaseClient;
  filters: CallMetricsFilters;
}): Promise<MetricCallRow[]> {
  const rows: MetricCallRow[] = [];
  let offset = 0;

  while (true) {
    let q = input.supabase
      .from("calls")
      .select("start_time, answer_time, end_time, duration_seconds")
      .gte("start_time", input.filters.from)
      .lte("start_time", input.filters.to)
      .order("start_time", { ascending: true });

    const tenantId = input.filters.tenantId?.trim();
    const queueId = input.filters.queueId?.trim();
    const agentId = input.filters.agentId?.trim();

    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (queueId) q = q.eq("queue_id", queueId);
    if (agentId) q = q.eq("agent_id", agentId);
    if (input.filters.direction) q = q.eq("direction", input.filters.direction);

    const { data, error } = await q.range(offset, offset + CALLS_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as MetricCallRow[];
    rows.push(...page);
    if (page.length < CALLS_PAGE_SIZE) break;
    offset += CALLS_PAGE_SIZE;
  }

  return rows;
}

export async function getDashboardCallMetricsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: CallMetricsFilters;
}): Promise<DashboardCallMetrics> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const calls = await fetchCallsForMetrics({ supabase, filters: input.filters });

  const totalCalls = calls.length;
  let answeredCalls = 0;
  let abandonedCalls = 0;
  let totalHandleSeconds = 0;
  let slaAnsweredWithinThreshold = 0;

  for (const call of calls) {
    if (call.answer_time) {
      answeredCalls += 1;
      totalHandleSeconds += Math.max(0, Number(call.duration_seconds) || 0);

      const startedAt = Date.parse(call.start_time);
      const answeredAt = Date.parse(call.answer_time);
      const answerDelaySeconds = (answeredAt - startedAt) / 1000;
      if (
        Number.isFinite(answerDelaySeconds) &&
        answerDelaySeconds <= input.filters.slaSeconds
      ) {
        slaAnsweredWithinThreshold += 1;
      }
    } else if (call.end_time) {
      abandonedCalls += 1;
    }
  }

  return {
    today_calls_count: totalCalls,
    answered_calls_count: answeredCalls,
    abandoned_calls_count: abandonedCalls,
    answer_rate_percent: percent(answeredCalls, totalCalls),
    abandon_rate_percent: percent(abandonedCalls, totalCalls),
    average_handle_seconds:
      answeredCalls > 0 ? Math.round(totalHandleSeconds / answeredCalls) : 0,
    sla_percent: percent(slaAnsweredWithinThreshold, answeredCalls),
    sla_answered_within_threshold_count: slaAnsweredWithinThreshold,
    sla_threshold_seconds: input.filters.slaSeconds,
  };
}

export async function getDashboardMetricsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: DashboardMetricsFilters;
}): Promise<DashboardMetricsResult> {
  const [onlineAgentsCount, callMetrics] = await Promise.all([
    getOnlineAgentsCountInSupabase(input),
    getDashboardCallMetricsInSupabase(input),
  ]);

  return {
    online_agents_count: onlineAgentsCount,
    ...callMetrics,
    from: input.filters.from,
    to: input.filters.to,
    online_statuses: normalizedStatuses(input.filters.onlineStatuses),
  };
}
