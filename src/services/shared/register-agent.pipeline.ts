import type {
  CreateAgentRequestBody,
  RegisterAgentResult,
} from "../../types/agent-registration.types.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import { registerAgentInSupabase } from "./supabase-register-agent.service.js";

/** Supabase only — Auth user, `user_roles`, `agents` (no Firebase). */
export async function registerAgentViaSupabase(input: {
  body: CreateAgentRequestBody;
}): Promise<RegisterAgentResult> {
  const { body } = input;

  const supabaseUrl = getSupabaseProjectUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new Error(
      missing.length > 0
        ? `Missing or unset Supabase env: ${missing.join(", ")}. Ensure project-root .env exists and restart the server.`
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for server-side agent registration)."
    );
  }

  return registerAgentInSupabase({
    supabaseUrl,
    serviceRoleKey,
    body,
  });
}
