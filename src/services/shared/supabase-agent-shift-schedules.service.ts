import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import {
  AGENT_SHIFT_SCHEDULE_WEEKDAYS,
  type AgentShiftScheduleFullDayValues,
  type AgentShiftScheduleListFilters,
  type AgentShiftScheduleListResult,
  type AgentShiftScheduleRow,
  type AgentShiftScheduleUpsertInput,
  type AgentShiftScheduleUpsertResult,
} from "../../types/agent-shift-schedule.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createSupabaseClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: AgentShiftScheduleListFilters): {
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

function normalizeDayValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function emptyDayValues(): AgentShiftScheduleFullDayValues {
  return {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  };
}

function dayValuesFromRow(
  row: AgentShiftScheduleRow | null
): AgentShiftScheduleFullDayValues {
  const values = emptyDayValues();
  if (!row) return values;

  for (const day of AGENT_SHIFT_SCHEDULE_WEEKDAYS) {
    values[day] = normalizeDayValue(row[day]);
  }
  return values;
}

export async function listAgentShiftSchedulesInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: AgentShiftScheduleListFilters;
}): Promise<AgentShiftScheduleListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("agent_shift_schedules")
    .select("*", { count: "exact" })
    .order("agent_id", { ascending: true });

  const scopeAgentId = input.filters.scopeAgentId?.trim();
  const agentId = input.filters.agentId?.trim();

  if (scopeAgentId) q = q.eq("agent_id", scopeAgentId);
  else if (agentId) q = q.eq("agent_id", agentId);

  const { data, error, count } = await q.range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as AgentShiftScheduleRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getAgentShiftScheduleByAgentIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
}): Promise<AgentShiftScheduleRow | null> {
  const agentId = input.agentId.trim();
  if (!agentId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_shift_schedules")
    .select("*")
    .eq("agent_id", agentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentShiftScheduleRow | null) ?? null;
}

export async function upsertAgentShiftScheduleInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  row: AgentShiftScheduleUpsertInput;
}): Promise<AgentShiftScheduleUpsertResult> {
  const agentId = input.row.agentId.trim();
  if (!agentId) throw new Error("agentId is required.");

  const existing = await getAgentShiftScheduleByAgentIdInSupabase({
    supabaseUrl: input.supabaseUrl,
    serviceRoleKey: input.serviceRoleKey,
    agentId,
  });
  const merged = dayValuesFromRow(existing);

  for (const day of AGENT_SHIFT_SCHEDULE_WEEKDAYS) {
    if (Object.prototype.hasOwnProperty.call(input.row.days, day)) {
      merged[day] = normalizeDayValue(input.row.days[day]);
    }
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const upsertRow: Record<string, unknown> = {
    agent_id: agentId,
    ...merged,
  };

  const { data, error } = await supabase
    .from("agent_shift_schedules")
    .upsert(upsertRow, { onConflict: "agent_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return {
    row: data as AgentShiftScheduleRow,
    created: existing == null,
  };
}
