import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import type { AgentAttendanceEventCreateInput } from "../../types/agent-attendance.types.js";
import { getAgentProfileByUserIdInSupabase } from "./supabase-agents.service.js";

function assertSupabase(): { supabaseUrl: string; serviceRoleKey: string } {
  const supabaseUrl = getSupabaseProjectUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new Error(
      missing.length > 0
        ? `Missing or unset Supabase env: ${missing.join(", ")}.`
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return { supabaseUrl, serviceRoleKey };
}

/** Fills tenant and display name from `agents` when not provided. */
export async function enrichAttendanceCreateInput(
  input: AgentAttendanceEventCreateInput
): Promise<AgentAttendanceEventCreateInput> {
  const hasDisplay =
    typeof input.agentDisplayName === "string" &&
    input.agentDisplayName.trim() !== "";
  const hasTenant =
    input.tenantId !== undefined && input.tenantId !== null && input.tenantId !== "";

  if (hasDisplay && hasTenant) return input;

  const { supabaseUrl, serviceRoleKey } = assertSupabase();
  const profile = await getAgentProfileByUserIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    userId: input.userId,
  });

  const enriched: AgentAttendanceEventCreateInput = {
    userId: input.userId,
    eventType: input.eventType,
  };
  if (input.occurredAt) enriched.occurredAt = input.occurredAt;
  enriched.tenantId = hasTenant ? (input.tenantId ?? null) : (profile?.tenant_id ?? null);
  enriched.agentDisplayName = hasDisplay
    ? (input.agentDisplayName ?? null)
    : profile?.name?.trim() || null;
  return enriched;
}
