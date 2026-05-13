import type {
  CreateAgentRequestBody,
  RegisterAgentResult,
} from "../types/agent-registration.types.js";
import { registerAgentViaSupabase } from "./shared/register-agent.pipeline.js";

/** Supabase only (auth, user_roles, agents). */
export async function registerAgent(
  body: CreateAgentRequestBody
): Promise<RegisterAgentResult> {
  return registerAgentViaSupabase({ body });
}
