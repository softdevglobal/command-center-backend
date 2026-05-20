import type {
  AgentShiftScheduleListFilters,
  AgentShiftScheduleListResult,
  AgentShiftScheduleRow,
  AgentShiftScheduleUpsertInput,
  AgentShiftScheduleUpsertResult,
} from "../../types/agent-shift-schedule.types.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import {
  getAgentShiftScheduleByAgentIdInSupabase,
  listAgentShiftSchedulesInSupabase,
  upsertAgentShiftScheduleInSupabase,
} from "./supabase-agent-shift-schedules.service.js";

function assertSupabaseForAgentShiftSchedules(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for agent shift schedule APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.agent_shift_schedules`. */
export async function listAgentShiftSchedulesViaSupabase(input: {
  filters: AgentShiftScheduleListFilters;
}): Promise<AgentShiftScheduleListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentShiftSchedules();
  return listAgentShiftSchedulesInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getAgentShiftScheduleByAgentIdViaSupabase(input: {
  agentId: string;
}): Promise<AgentShiftScheduleRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentShiftSchedules();
  return getAgentShiftScheduleByAgentIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    agentId: input.agentId,
  });
}

export async function upsertAgentShiftScheduleViaSupabase(input: {
  row: AgentShiftScheduleUpsertInput;
}): Promise<AgentShiftScheduleUpsertResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentShiftSchedules();
  return upsertAgentShiftScheduleInSupabase({
    supabaseUrl,
    serviceRoleKey,
    row: input.row,
  });
}
