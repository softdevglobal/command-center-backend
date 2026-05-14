import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";
import {
  registerAgentViaBlack,
  type RegisterAgentViaBlackResult,
} from "./black/register-agent-via-black.service.js";

/**
 * Delegates agent registration to BMS Pro Black, which performs the full
 * Supabase work (Auth user + `user_roles` + `agents` row) AND creates the
 * corresponding Firebase Auth user in BMS Black so the agent can be issued
 * a Firebase custom token at login.
 */
export async function registerAgent(
  body: CreateAgentRequestBody,
  options: { supabaseBearer: string }
): Promise<RegisterAgentViaBlackResult> {
  return registerAgentViaBlack({ body, supabaseBearer: options.supabaseBearer });
}
