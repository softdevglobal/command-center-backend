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
  const userId = input.userId.trim();
  if (!userId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const id = (data as { id?: string } | null)?.id;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}
