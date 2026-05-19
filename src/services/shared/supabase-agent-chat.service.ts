import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AgentConversationListFilters,
  AgentConversationListResult,
  AgentConversationRow,
  AgentMessageListFilters,
  AgentMessageListResult,
  AgentMessageRow,
  ParticipantPair,
} from "../../types/agent-chat.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: { limit?: number; offset?: number }): {
  limit: number;
  offset: number;
} {
  const limitRaw = filters.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT)
  );
  const offsetRaw = filters.offset ?? 0;
  const offset = Math.max(
    0,
    Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0
  );
  return { limit, offset };
}

export async function agentExistsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
}): Promise<boolean> {
  const id = input.agentId.trim();
  if (!id) return false;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as { id?: string } | null)?.id);
}

export async function listAgentConversationsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: AgentConversationListFilters;
}): Promise<AgentConversationListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("agent_conversations")
    .select("*", { count: "exact" })
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const scopeAgentId = input.filters.scopeAgentId?.trim();
  const participantAgentId = input.filters.participantAgentId?.trim();

  if (scopeAgentId) {
    q = q.or(
      `participant_a.eq.${scopeAgentId},participant_b.eq.${scopeAgentId}`
    );
  } else if (participantAgentId) {
    q = q.or(
      `participant_a.eq.${participantAgentId},participant_b.eq.${participantAgentId}`
    );
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as AgentConversationRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getAgentConversationByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<AgentConversationRow | null> {
  const key = input.id.trim();
  if (!key) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("id", key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentConversationRow | null) ?? null;
}

export async function getAgentConversationByPairInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  pair: ParticipantPair;
}): Promise<AgentConversationRow | null> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("participant_a", input.pair.participant_a)
    .eq("participant_b", input.pair.participant_b)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentConversationRow | null) ?? null;
}

export async function createAgentConversationInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  pair: ParticipantPair;
}): Promise<AgentConversationRow> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({
      participant_a: input.pair.participant_a,
      participant_b: input.pair.participant_b,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AgentConversationRow;
}

export async function listAgentMessagesInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: AgentMessageListFilters;
}): Promise<AgentMessageListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const conversationId = input.filters.conversationId.trim();
  if (!conversationId) {
    return { data: [], total: 0, limit, offset };
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  let q = supabase
    .from("agent_messages")
    .select("*", { count: "exact" })
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const after = input.filters.after?.trim();
  if (after) q = q.gt("created_at", after);

  const { data, error, count } = await q.range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as AgentMessageRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function createAgentMessageInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  conversationId: string;
  senderId: string;
  content: string;
}): Promise<AgentMessageRow> {
  const conversationId = input.conversationId.trim();
  const senderId = input.senderId.trim();
  const content = input.content.trim();
  if (!conversationId || !senderId || !content) {
    throw new Error("conversationId, senderId, and content are required.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AgentMessageRow;
}

export async function markAgentMessagesReadInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  conversationId: string;
  readerAgentId: string;
}): Promise<number> {
  const conversationId = input.conversationId.trim();
  const readerAgentId = input.readerAgentId.trim();
  if (!conversationId || !readerAgentId) return 0;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_messages")
    .update({ is_read: true })
    .eq("conversation_id", conversationId)
    .neq("sender_id", readerAgentId)
    .eq("is_read", false)
    .select("id");

  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export async function countUnreadAgentMessagesInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  conversationId: string;
  readerAgentId: string;
}): Promise<number> {
  const conversationId = input.conversationId.trim();
  const readerAgentId = input.readerAgentId.trim();
  if (!conversationId || !readerAgentId) return 0;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { count, error } = await supabase
    .from("agent_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .neq("sender_id", readerAgentId)
    .eq("is_read", false);

  if (error) throw new Error(error.message);
  return count ?? 0;
}
