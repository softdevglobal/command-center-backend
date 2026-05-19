import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import {
  getAgentIdByUserIdInSupabase,
  getAgentUserIdByAgentIdInSupabase,
} from "./supabase-agents.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ResolvedAttendanceTarget = {
  userId: string;
  agentId: string | null;
};

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

export function isSupabaseAuthUserId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function looksLikeAgentRowId(value: string): boolean {
  return value.trim().startsWith("agent-");
}

async function userIdFromAgentRowId(agentId: string): Promise<string | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabase();
  return getAgentUserIdByAgentIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    agentId,
  });
}

/**
 * Resolves attendance subject from `agentId`, `userId` (Auth UUID), or default.
 * If `userId` is an `agents.id` (e.g. agent-1777874280295), it is resolved automatically.
 */
export async function resolveAttendanceTarget(input: {
  userId?: string;
  agentId?: string;
  defaultUserId: string;
}): Promise<ResolvedAttendanceTarget | { error: string; status: number }> {
  const agentIdParam = input.agentId?.trim();
  const userIdParam = input.userId?.trim();

  if (agentIdParam && userIdParam) {
    return {
      status: 400,
      error: "Provide either userId (Supabase Auth UUID) or agentId (agents.id), not both.",
    };
  }

  if (agentIdParam) {
    const userId = await userIdFromAgentRowId(agentIdParam);
    if (!userId) {
      return {
        status: 404,
        error: `No agent found with id "${agentIdParam}", or agent has no linked user_id.`,
      };
    }
    return { userId, agentId: agentIdParam };
  }

  if (userIdParam) {
    if (isSupabaseAuthUserId(userIdParam)) {
      const linkedAgentId = await (async () => {
        const { supabaseUrl, serviceRoleKey } = assertSupabase();
        return getAgentIdByUserIdInSupabase({
          supabaseUrl,
          serviceRoleKey,
          userId: userIdParam,
        });
      })();
      return { userId: userIdParam, agentId: linkedAgentId };
    }

    if (looksLikeAgentRowId(userIdParam)) {
      const userId = await userIdFromAgentRowId(userIdParam);
      if (!userId) {
        return {
          status: 404,
          error: `No agent found with id "${userIdParam}", or agent has no linked user_id. Use agentId= instead of userId= for agents.id.`,
        };
      }
      return { userId, agentId: userIdParam };
    }

    return {
      status: 400,
      error:
        'userId must be a Supabase Auth UUID. For agents.id (e.g. agent-1777874280295), use agentId= instead.',
    };
  }

  const linkedAgentId = await (async () => {
    const { supabaseUrl, serviceRoleKey } = assertSupabase();
    return getAgentIdByUserIdInSupabase({
      supabaseUrl,
      serviceRoleKey,
      userId: input.defaultUserId,
    });
  })();

  return {
    userId: input.defaultUserId,
    agentId: linkedAgentId,
  };
}
