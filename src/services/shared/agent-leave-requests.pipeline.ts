import type {
  AgentLeaveRequestCreateInput,
  AgentLeaveRequestListFilters,
  AgentLeaveRequestListResult,
  AgentLeaveRequestReviewInput,
  AgentLeaveRequestRow,
} from "../../types/agent-leave-request.types.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import { getAgentProfileByUserIdInSupabase } from "./supabase-agents.service.js";
import {
  createAgentLeaveRequestInSupabase,
  deletePendingAgentLeaveRequestInSupabase,
  getAgentLeaveRequestByIdInSupabase,
  listAgentLeaveRequestsInSupabase,
  reviewAgentLeaveRequestInSupabase,
} from "./supabase-agent-leave-requests.service.js";

function assertSupabaseForAgentLeaveRequests(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for agent leave request APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

async function enrichLeaveRequestCreateInput(
  input: AgentLeaveRequestCreateInput,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<AgentLeaveRequestCreateInput> {
  const hasDisplay =
    typeof input.agentDisplayName === "string" &&
    input.agentDisplayName.trim() !== "";
  const hasTenant =
    input.tenantId !== undefined && input.tenantId !== null && input.tenantId !== "";

  if (hasDisplay && hasTenant) return input;

  const profile = await getAgentProfileByUserIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    userId: input.userId,
  });

  const enriched: AgentLeaveRequestCreateInput = {
    userId: input.userId,
    startDate: input.startDate,
    endDate: input.endDate,
    durationType: input.durationType,
  };
  if (input.halfDayPart !== undefined) enriched.halfDayPart = input.halfDayPart;
  if (input.reason !== undefined) enriched.reason = input.reason;
  if (input.attachmentStoragePath !== undefined) {
    enriched.attachmentStoragePath = input.attachmentStoragePath;
  }
  enriched.tenantId = hasTenant ? (input.tenantId ?? null) : (profile?.tenant_id ?? null);
  enriched.agentDisplayName = hasDisplay
    ? (input.agentDisplayName ?? null)
    : profile?.name?.trim() || null;
  return enriched;
}

/** Supabase only — `public.agent_leave_requests`. */
export async function listAgentLeaveRequestsViaSupabase(input: {
  filters: AgentLeaveRequestListFilters;
}): Promise<AgentLeaveRequestListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentLeaveRequests();
  return listAgentLeaveRequestsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getAgentLeaveRequestByIdViaSupabase(input: {
  id: string;
}): Promise<AgentLeaveRequestRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentLeaveRequests();
  return getAgentLeaveRequestByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}

export async function createAgentLeaveRequestViaSupabase(input: {
  row: AgentLeaveRequestCreateInput;
}): Promise<AgentLeaveRequestRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentLeaveRequests();
  const row = await enrichLeaveRequestCreateInput(
    input.row,
    supabaseUrl,
    serviceRoleKey
  );
  return createAgentLeaveRequestInSupabase({
    supabaseUrl,
    serviceRoleKey,
    row,
  });
}

export async function deletePendingAgentLeaveRequestViaSupabase(input: {
  id: string;
  userId: string;
}): Promise<AgentLeaveRequestRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentLeaveRequests();
  return deletePendingAgentLeaveRequestInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
    userId: input.userId,
  });
}

export async function reviewAgentLeaveRequestViaSupabase(input: {
  id: string;
  review: AgentLeaveRequestReviewInput;
}): Promise<AgentLeaveRequestRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentLeaveRequests();
  return reviewAgentLeaveRequestInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
    review: input.review,
  });
}
