import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

/** Resolves `agents.id` for a Supabase Auth user (`agents.user_id`). */
export async function getAgentIdByUserIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
}): Promise<string | null> {
  const profile = await getAgentProfileByUserIdInSupabase(input);
  return profile?.id ?? null;
}

/** Agent row fields used when recording attendance. */
export async function getAgentProfileByUserIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
}): Promise<{
  id: string;
  name: string;
  tenant_id: string | null;
} | null> {
  const userId = input.userId.trim();
  if (!userId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, tenant_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const row = data as {
    id?: string;
    name?: string;
    tenant_id?: string | null;
  } | null;
  const id = row?.id?.trim();
  if (!id) return null;
  return {
    id,
    name: typeof row?.name === "string" ? row.name : "",
    tenant_id:
      typeof row?.tenant_id === "string" && row.tenant_id.trim() !== ""
        ? row.tenant_id
        : null,
  };
}

/** Resolves Supabase Auth `user_id` from `agents.id` (e.g. agent-1777874280295). */
export async function getAgentUserIdByAgentIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
}): Promise<string | null> {
  const agentId = input.agentId.trim();
  if (!agentId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select("user_id")
    .eq("id", agentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const userId = (data as { user_id?: string } | null)?.user_id;
  return typeof userId === "string" && userId.trim() !== "" ? userId : null;
}

export type AgentProfileRow = {
  id: string;
  user_id: string;
  name: string;
  tenant_id: string | null;
};

/** Agent profiles for report labels (`agents.id`, display name). */
export async function listAgentProfilesInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userIds?: string[];
}): Promise<AgentProfileRow[]> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  let q = supabase
    .from("agents")
    .select("id, user_id, name, tenant_id")
    .not("user_id", "is", null);

  const userIds = input.userIds?.map((id) => id.trim()).filter(Boolean);
  if (userIds?.length) {
    q = q.in("user_id", userIds);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const r = row as {
        id?: string;
        user_id?: string;
        name?: string;
        tenant_id?: string | null;
      };
      const id = r.id?.trim();
      const userId = r.user_id?.trim();
      if (!id || !userId) return null;
      return {
        id,
        user_id: userId,
        name: typeof r.name === "string" ? r.name : "",
        tenant_id:
          typeof r.tenant_id === "string" && r.tenant_id.trim() !== ""
            ? r.tenant_id
            : null,
      } satisfies AgentProfileRow;
    })
    .filter((row): row is AgentProfileRow => row != null);
}
