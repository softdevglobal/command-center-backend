import type {
  AgentConversationCreateInput,
  AgentConversationListFilters,
  AgentConversationListResult,
  AgentConversationRow,
  AgentMessageListFilters,
  AgentMessageListResult,
  AgentMessageRow,
  ParticipantPair,
} from "../../types/agent-chat.types.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import { getAgentIdByUserIdInSupabase } from "./supabase-agents.service.js";
import {
  agentExistsInSupabase,
  countUnreadAgentMessagesInSupabase,
  createAgentConversationInSupabase,
  createAgentMessageInSupabase,
  getAgentConversationByIdInSupabase,
  getAgentConversationByPairInSupabase,
  listAgentConversationsInSupabase,
  listAgentMessagesInSupabase,
  markAgentMessagesReadInSupabase,
} from "./supabase-agent-chat.service.js";

function assertSupabaseForAgentChat(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for agent chat APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

export async function listAgentConversationsViaSupabase(input: {
  filters: AgentConversationListFilters;
}): Promise<AgentConversationListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return listAgentConversationsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getAgentConversationByIdViaSupabase(input: {
  id: string;
}): Promise<AgentConversationRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return getAgentConversationByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}

export async function getOrCreateAgentConversationViaSupabase(input: {
  pair: ParticipantPair;
}): Promise<{ row: AgentConversationRow; created: boolean }> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();

  const existing = await getAgentConversationByPairInSupabase({
    supabaseUrl,
    serviceRoleKey,
    pair: input.pair,
  });
  if (existing) return { row: existing, created: false };

  const row = await createAgentConversationInSupabase({
    supabaseUrl,
    serviceRoleKey,
    pair: input.pair,
  });
  return { row, created: true };
}

export async function verifyAgentExistsViaSupabase(input: {
  agentId: string;
}): Promise<boolean> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return agentExistsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    agentId: input.agentId,
  });
}

export async function listAgentMessagesViaSupabase(input: {
  filters: AgentMessageListFilters;
}): Promise<AgentMessageListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return listAgentMessagesInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function createAgentMessageViaSupabase(input: {
  conversationId: string;
  senderId: string;
  content: string;
}): Promise<AgentMessageRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return createAgentMessageInSupabase({
    supabaseUrl,
    serviceRoleKey,
    conversationId: input.conversationId,
    senderId: input.senderId,
    content: input.content,
  });
}

export async function markAgentMessagesReadViaSupabase(input: {
  conversationId: string;
  readerAgentId: string;
}): Promise<number> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return markAgentMessagesReadInSupabase({
    supabaseUrl,
    serviceRoleKey,
    conversationId: input.conversationId,
    readerAgentId: input.readerAgentId,
  });
}

export async function countUnreadAgentMessagesViaSupabase(input: {
  conversationId: string;
  readerAgentId: string;
}): Promise<number> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return countUnreadAgentMessagesInSupabase({
    supabaseUrl,
    serviceRoleKey,
    conversationId: input.conversationId,
    readerAgentId: input.readerAgentId,
  });
}

export async function resolveAgentIdForUserViaSupabase(input: {
  userId: string;
}): Promise<string | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAgentChat();
  return getAgentIdByUserIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    userId: input.userId,
  });
}
