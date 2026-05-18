import type {
  CallListFilters,
  CallListResult,
  CallRow,
} from "../../types/call.types.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import { getAgentIdByUserIdInSupabase } from "./supabase-agents.service.js";
import {
  getCallByIdInSupabase,
  listCallsInSupabase,
} from "./supabase-calls.service.js";

function assertSupabaseForCalls(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for calls APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.calls`. */
export async function listCallsViaSupabase(input: {
  filters: CallListFilters;
}): Promise<CallListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForCalls();
  return listCallsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getCallByIdViaSupabase(input: {
  id: string;
}): Promise<CallRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForCalls();
  return getCallByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}

export async function resolveAgentIdForUserViaSupabase(input: {
  userId: string;
}): Promise<string | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForCalls();
  return getAgentIdByUserIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    userId: input.userId,
  });
}
