import type {
  AgentConversationCreateInput,
  AgentConversationListFilters,
  AgentConversationListResult,
  AgentConversationRow,
  AgentMessageCreateInput,
  AgentMessageListFilters,
  AgentMessageListResult,
  AgentMessageRow,
} from "../types/agent-chat.types.js";
import { normalizeParticipantPair } from "../types/agent-chat.types.js";
import {
  countUnreadAgentMessagesViaSupabase,
  createAgentMessageViaSupabase,
  getAgentConversationByIdViaSupabase,
  getOrCreateAgentConversationViaSupabase,
  listAgentConversationsViaSupabase,
  listAgentMessagesViaSupabase,
  markAgentMessagesReadViaSupabase,
  verifyAgentExistsViaSupabase,
} from "./shared/agent-chat.pipeline.js";

export function agentMayAccessConversation(
  row: AgentConversationRow,
  agentId: string
): boolean {
  return (
    row.participant_a === agentId || row.participant_b === agentId
  );
}

export function peerAgentIdFor(
  row: AgentConversationRow,
  selfAgentId: string
): string | null {
  if (row.participant_a === selfAgentId) return row.participant_b;
  if (row.participant_b === selfAgentId) return row.participant_a;
  return null;
}

export async function listConversations(
  filters: AgentConversationListFilters,
  options?: { includeUnreadForAgentId?: string }
): Promise<AgentConversationListResult & { data: AgentConversationRow[] }> {
  const result = await listAgentConversationsViaSupabase({ filters });

  if (!options?.includeUnreadForAgentId) {
    return result;
  }

  const agentId = options.includeUnreadForAgentId;
  const withUnread = await Promise.all(
    result.data.map(async (row) => {
      const unread_count = await countUnreadAgentMessagesViaSupabase({
        conversationId: row.id,
        readerAgentId: agentId,
      });
      return { ...row, unread_count };
    })
  );

  return { ...result, data: withUnread };
}

export async function getConversationById(
  id: string
): Promise<AgentConversationRow | null> {
  return getAgentConversationByIdViaSupabase({ id });
}

export async function resolveChatActorAgentId(input: {
  linkedAgentId: string | null;
  selfAgentId?: string;
}): Promise<string> {
  const linked = input.linkedAgentId?.trim();
  if (linked) return linked;

  const declared = input.selfAgentId?.trim();
  if (!declared) {
    throw new Error(
      "No agent linked to this user. Link agents.user_id to your account, or send selfAgentId (your agents.id)."
    );
  }

  const exists = await verifyAgentExistsViaSupabase({ agentId: declared });
  if (!exists) {
    throw new Error("selfAgentId not found.");
  }

  return declared;
}

export async function getOrCreateConversation(
  actorAgentId: string,
  input: AgentConversationCreateInput
): Promise<{ row: AgentConversationRow; created: boolean }> {
  const peerAgentId = input.peerAgentId.trim();
  if (!peerAgentId) {
    throw new Error("peerAgentId is required.");
  }

  const pair = normalizeParticipantPair(actorAgentId, peerAgentId);

  const peerExists = await verifyAgentExistsViaSupabase({ agentId: peerAgentId });
  if (!peerExists) {
    throw new Error("Peer agent not found.");
  }

  return getOrCreateAgentConversationViaSupabase({ pair });
}

export async function listMessages(
  filters: AgentMessageListFilters
): Promise<AgentMessageListResult> {
  return listAgentMessagesViaSupabase({ filters });
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  input: AgentMessageCreateInput
): Promise<AgentMessageRow> {
  const content = input.content?.trim();
  if (!content) {
    throw new Error("content is required.");
  }

  return createAgentMessageViaSupabase({
    conversationId,
    senderId,
    content,
  });
}

export async function markConversationRead(
  conversationId: string,
  readerAgentId: string
): Promise<number> {
  return markAgentMessagesReadViaSupabase({
    conversationId,
    readerAgentId,
  });
}
