import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import type {
  AgentAttendanceEventCreateInput,
  AgentAttendanceEventRow,
  AgentAttendanceEventType,
  AgentAttendanceListFilters,
  AgentAttendanceListResult,
} from "../../types/agent-attendance.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const EVENT_TYPES: AgentAttendanceEventType[] = [
  "clock_in",
  "break_start",
  "break_end",
  "clock_out",
];

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createSupabaseClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: AgentAttendanceListFilters): {
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

export function isAgentAttendanceEventType(
  value: string
): value is AgentAttendanceEventType {
  return (EVENT_TYPES as string[]).includes(value);
}

export async function listAgentAttendanceEventsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: AgentAttendanceListFilters;
}): Promise<AgentAttendanceListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("agent_attendance_events")
    .select("*", { count: "exact" })
    .order("occurred_at", { ascending: false });

  const scopeUserId = input.filters.scopeUserId?.trim();
  const userId = input.filters.userId?.trim();
  const tenantId = input.filters.tenantId?.trim();
  const eventType = input.filters.eventType;
  const from = input.filters.from?.trim();
  const to = input.filters.to?.trim();

  if (scopeUserId) q = q.eq("user_id", scopeUserId);
  else if (userId) q = q.eq("user_id", userId);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (eventType) q = q.eq("event_type", eventType);
  if (from) q = q.gte("occurred_at", from);
  if (to) q = q.lte("occurred_at", to);

  const { data, error, count } = await q.range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as AgentAttendanceEventRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getAgentAttendanceEventByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<AgentAttendanceEventRow | null> {
  const key = input.id.trim();
  if (!key) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_attendance_events")
    .select("*")
    .eq("id", key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentAttendanceEventRow | null) ?? null;
}

export async function getLatestAgentAttendanceEventForUserInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
}): Promise<AgentAttendanceEventRow | null> {
  const userId = input.userId.trim();
  if (!userId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_attendance_events")
    .select("*")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentAttendanceEventRow | null) ?? null;
}

export async function createAgentAttendanceEventInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  row: AgentAttendanceEventCreateInput;
}): Promise<AgentAttendanceEventRow> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const occurredAt = input.row.occurredAt?.trim() || new Date().toISOString();

  const insertRow: Record<string, unknown> = {
    user_id: input.row.userId.trim(),
    event_type: input.row.eventType,
    occurred_at: occurredAt,
    tenant_id: input.row.tenantId ?? null,
    agent_display_name: input.row.agentDisplayName?.trim() || null,
  };

  const { data, error } = await supabase
    .from("agent_attendance_events")
    .insert(insertRow)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AgentAttendanceEventRow;
}

const REPORT_PAGE_SIZE = 1000;
const REPORT_MAX_EVENTS = 50_000;

/** All events in a date range for attendance reports (paginated). */
export async function listAgentAttendanceEventsForReportInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  fromIso: string;
  toIso: string;
  userId?: string;
  tenantId?: string;
}): Promise<AgentAttendanceEventRow[]> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const rows: AgentAttendanceEventRow[] = [];
  let offset = 0;

  while (rows.length < REPORT_MAX_EVENTS) {
    let q = supabase
      .from("agent_attendance_events")
      .select("*")
      .gte("occurred_at", input.fromIso)
      .lte("occurred_at", input.toIso)
      .order("occurred_at", { ascending: true });

    const userId = input.userId?.trim();
    const tenantId = input.tenantId?.trim();
    if (userId) q = q.eq("user_id", userId);
    if (tenantId) q = q.eq("tenant_id", tenantId);

    const { data, error } = await q.range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as AgentAttendanceEventRow[];
    rows.push(...page);
    if (page.length < REPORT_PAGE_SIZE) break;
    offset += REPORT_PAGE_SIZE;
  }

  if (rows.length >= REPORT_MAX_EVENTS) {
    throw new Error(
      `Too many attendance events in range (>${REPORT_MAX_EVENTS}). Narrow the from/to dates.`
    );
  }

  return rows;
}
