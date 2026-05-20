/** Row shape for `public.agent_conversations`. */
export type AgentConversationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  participant_a: string;
  participant_b: string;
  last_message: string | null;
  last_message_at: string | null;
};

/** Row shape for `public.agent_messages`. */
export type AgentMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
};

/** POST /api/agent-chat/conversations body. */
export type AgentConversationCreateInput = {
  peerAgentId: string;
  /**
   * Super admin without `agents.user_id`: your `agents.id` as conversation participant.
   * Ignored when the signed-in user already has a linked agent row.
   */
  selfAgentId?: string;
};

/** POST /api/agent-chat/conversations/:id/messages body. */
export type AgentMessageCreateInput = {
  content: string;
  /** Same as `AgentConversationCreateInput.selfAgentId` when super admin has no linked agent. */
  selfAgentId?: string;
};

export type AgentConversationListFilters = {
  /** When set, only conversations involving this agent. */
  scopeAgentId?: string;
  /** Super admin: filter to conversations with this agent as either participant. */
  participantAgentId?: string;
  limit?: number;
  offset?: number;
};

export type AgentConversationListResult = {
  data: AgentConversationRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AgentMessageListFilters = {
  conversationId: string;
  limit?: number;
  offset?: number;
  /** When set, only messages after this ISO timestamp. */
  after?: string;
};

export type AgentMessageListResult = {
  data: AgentMessageRow[];
  total: number;
  limit: number;
  offset: number;
};

/** Ordered pair satisfying `participant_a < participant_b`. */
export type ParticipantPair = {
  participant_a: string;
  participant_b: string;
};

export function normalizeParticipantPair(
  agentIdA: string,
  agentIdB: string
): ParticipantPair {
  const a = agentIdA.trim();
  const b = agentIdB.trim();
  if (!a || !b) {
    throw new Error("Both agent ids are required.");
  }
  if (a === b) {
    throw new Error("Cannot create a conversation with yourself.");
  }
  if (a < b) return { participant_a: a, participant_b: b };
  return { participant_a: b, participant_b: a };
}
