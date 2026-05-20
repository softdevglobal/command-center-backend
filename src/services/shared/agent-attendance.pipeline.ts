import type {
  AgentAttendanceEventCreateInput,
  AgentAttendanceEventRow,
  AgentAttendanceListFilters,
  AgentAttendanceListResult,
  AgentAttendanceReportFilters,
  AgentAttendanceReportResult,
} from "../../types/agent-attendance.types.js";
import {
  buildAttendanceReport,
  parseReportDateRange,
} from "./agent-attendance-report.js";
import { listAgentProfilesInSupabase } from "./supabase-agents.service.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import {
  createAgentAttendanceEventInSupabase,
  getAgentAttendanceEventByIdInSupabase,
  getLatestAgentAttendanceEventForUserInSupabase,
  listAgentAttendanceEventsForReportInSupabase,
  listAgentAttendanceEventsInSupabase,
} from "./supabase-agent-attendance.service.js";

function assertSupabaseForAgentAttendance(): {
  supabaseUrl: string;
  serviceRoleKey: string;
} {
  const supabaseUrl = getSupabaseProjectUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new Error(
      missing.length > 0
        ? `Missing or unset Supabase env: ${missing.join(", ")}. Ensure project-root .env exists and restart the server.`
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for agent attendance APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.agent_attendance_events`. */
export async function listAgentAttendanceEventsViaSupabase(input: {
  filters: AgentAttendanceListFilters;
}): Promise<AgentAttendanceListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentAttendance();
  return listAgentAttendanceEventsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getAgentAttendanceEventByIdViaSupabase(input: {
  id: string;
}): Promise<AgentAttendanceEventRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentAttendance();
  return getAgentAttendanceEventByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}

export async function getLatestAgentAttendanceEventForUserViaSupabase(input: {
  userId: string;
}): Promise<AgentAttendanceEventRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentAttendance();
  return getLatestAgentAttendanceEventForUserInSupabase({
    supabaseUrl,
    serviceRoleKey,
    userId: input.userId,
  });
}

export async function createAgentAttendanceEventViaSupabase(input: {
  row: AgentAttendanceEventCreateInput;
}): Promise<AgentAttendanceEventRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentAttendance();
  return createAgentAttendanceEventInSupabase({
    supabaseUrl,
    serviceRoleKey,
    row: input.row,
  });
}

export async function getAgentAttendanceReportViaSupabase(input: {
  filters: AgentAttendanceReportFilters;
}): Promise<AgentAttendanceReportResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentAttendance();
  const range = parseReportDateRange({
    from: input.filters.from,
    to: input.filters.to,
  });
  if ("error" in range) {
    throw new Error(range.error);
  }

  const userId = input.filters.userId?.trim();
  const tenantId = input.filters.tenantId?.trim();

  const events = await listAgentAttendanceEventsForReportInSupabase({
    supabaseUrl,
    serviceRoleKey,
    fromIso: range.fromIso,
    toIso: range.toIso,
    ...(userId ? { userId } : {}),
    ...(tenantId ? { tenantId } : {}),
  });

  const userIds = userId
    ? [userId]
    : [...new Set(events.map((e) => e.user_id))];

  const profileInput: {
    supabaseUrl: string;
    serviceRoleKey: string;
    userIds?: string[];
  } = { supabaseUrl, serviceRoleKey };
  if (userIds.length > 0) profileInput.userIds = userIds;

  const profiles = await listAgentProfilesInSupabase(profileInput);

  const profileMap = new Map<
    string,
    { agent_id: string | null; agent_display_name: string | null }
  >();
  for (const p of profiles) {
    profileMap.set(p.user_id, {
      agent_id: p.id,
      agent_display_name: p.name || null,
    });
  }

  return buildAttendanceReport({
    groupBy: input.filters.groupBy,
    from: input.filters.from,
    to: input.filters.to,
    events,
    profiles: profileMap,
    rangeEndMs: range.rangeEndMs,
    ...(userId ? { singleUserId: userId } : {}),
  });
}
