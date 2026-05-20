import { Router } from "express";

import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import { sessionSummaryFromLocals } from "../../services/auth/supabase-auth.service.js";
import {
  agentMayAccessConversation,
  getConversationById,
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  resolveChatActorAgentId,
  sendMessage,
} from "../../services/agent-chat.service.js";
import { resolveAgentIdForUserViaSupabase } from "../../services/shared/agent-chat.pipeline.js";
import type {
  AgentConversationCreateInput,
  AgentConversationListFilters,
  AgentMessageCreateInput,
  AgentMessageListFilters,
} from "../../types/agent-chat.types.js";

const router = Router();

router.use(attachSupabaseUser);

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function queryInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function paramId(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function isSuperAdmin(roles: string[]): boolean {
  return roles.some((r) => roleMayRegisterAgents(r));
}

function isAgent(roles: string[]): boolean {
  return roles.includes("agent");
}

type ChatAccess =
  | { kind: "super-admin"; agentId: string | null }
  | { kind: "agent"; agentId: string };

async function resolveChatAccess(
  roles: string[],
  userId: string
): Promise<ChatAccess | { error: string; status: number }> {
  const linkedAgentId = await resolveAgentIdForUserViaSupabase({ userId });

  if (isSuperAdmin(roles)) {
    return { kind: "super-admin", agentId: linkedAgentId };
  }

  if (!isAgent(roles)) {
    return {
      status: 403,
      error:
        "Only super admins or agents may access agent chat. Sign in with an account that has the appropriate user_roles entry.",
    };
  }

  if (!linkedAgentId) {
    return {
      status: 403,
      error:
        "No agent record linked to this user. Ensure agents.user_id matches your Supabase Auth user id.",
    };
  }

  return { kind: "agent", agentId: linkedAgentId };
}

async function resolveActorForWrite(
  access: ChatAccess,
  selfAgentId?: string
): Promise<{ actorId: string } | { error: string; status: number }> {
  try {
    const actorInput: Parameters<typeof resolveChatActorAgentId>[0] = {
      linkedAgentId: access.agentId,
    };
    if (selfAgentId) actorInput.selfAgentId = selfAgentId;
    const actorId = await resolveChatActorAgentId(actorInput);
    return { actorId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid chat actor.";
    const status = msg.includes("not found") ? 404 : 403;
    return { error: msg, status };
  }
}

function authExtras(res: import("express").Response) {
  const auth = res.locals.supabaseAuth;
  if (!auth) return {};
  return {
    authenticatedAs: sessionSummaryFromLocals({
      user: auth.user,
      roles: auth.roles,
    }),
  };
}

function parseConversationListFilters(req: {
  query: Record<string, unknown>;
}): AgentConversationListFilters {
  const filters: AgentConversationListFilters = {};
  const participantAgentId = queryString(req.query.participantAgentId);
  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);

  if (participantAgentId) filters.participantAgentId = participantAgentId;
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  return filters;
}

function optionalSelfAgentId(body: object): string | undefined {
  if (
    "selfAgentId" in body &&
    typeof (body as { selfAgentId: unknown }).selfAgentId === "string"
  ) {
    const id = (body as { selfAgentId: string }).selfAgentId.trim();
    return id || undefined;
  }
  return undefined;
}

function parseMessageBody(body: unknown): AgentMessageCreateInput | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object." };
  }
  const content =
    "content" in body && typeof (body as { content: unknown }).content === "string"
      ? (body as { content: string }).content
      : undefined;
  if (!content?.trim()) {
    return { error: "content is required." };
  }
  const parsed: AgentMessageCreateInput = { content };
  const selfAgentId = optionalSelfAgentId(body);
  if (selfAgentId) parsed.selfAgentId = selfAgentId;
  return parsed;
}

function parseConversationCreateBody(
  body: unknown
): AgentConversationCreateInput | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object." };
  }
  const peerAgentId =
    "peerAgentId" in body &&
    typeof (body as { peerAgentId: unknown }).peerAgentId === "string"
      ? (body as { peerAgentId: string }).peerAgentId
      : undefined;
  if (!peerAgentId?.trim()) {
    return { error: "peerAgentId is required." };
  }
  const parsed: AgentConversationCreateInput = { peerAgentId: peerAgentId.trim() };
  const selfAgentId = optionalSelfAgentId(body);
  if (selfAgentId) parsed.selfAgentId = selfAgentId;
  return parsed;
}

/**
 * GET /api/agent-chat/conversations
 * Agent: own conversations with unread_count. Super admin: all; optional ?participantAgentId=
 */
router.get("/conversations", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveChatAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const filters = parseConversationListFilters(req);
  if (access.kind === "agent") {
    filters.scopeAgentId = access.agentId;
    delete filters.participantAgentId;
  }

  try {
    const unreadAgentId = access.agentId ?? undefined;
    const unreadOpts = unreadAgentId
      ? { includeUnreadForAgentId: unreadAgentId }
      : undefined;
    const result = await listConversations(filters, unreadOpts);
    res.json({
      success: true,
      ...result,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to list conversations";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/agent-chat/conversations
 * Body: { peerAgentId, selfAgentId? }. Super admin or agent; returns existing or new row.
 */
router.post("/conversations", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveChatAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const parsed = parseConversationCreateBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  const actor = await resolveActorForWrite(access, parsed.selfAgentId);
  if ("error" in actor) {
    res.status(actor.status).json({ success: false, error: actor.error });
    return;
  }

  try {
    const { row, created } = await getOrCreateConversation(
      actor.actorId,
      parsed
    );
    res.status(created ? 201 : 200).json({
      success: true,
      data: row,
      created,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create conversation";
    const status = msg.includes("not found") ? 404 : 400;
    res.status(status).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-chat/conversations/:id
 */
router.get("/conversations/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveChatAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const id = paramId(req.params.id);

  try {
    const row = await getConversationById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "Conversation not found." });
      return;
    }

    if (access.kind === "agent" && access.agentId) {
      if (!agentMayAccessConversation(row, access.agentId)) {
        res.status(404).json({ success: false, error: "Conversation not found." });
        return;
      }
    }

    res.json({
      success: true,
      data: row,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to load conversation";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/agent-chat/conversations/:id/messages
 * Query: limit, offset, after (ISO 8601)
 */
router.get("/conversations/:id/messages", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveChatAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const conversationId = paramId(req.params.id);
  const limit = queryInt(req.query.limit);
  const offset = queryInt(req.query.offset);
  const after = queryString(req.query.after);

  try {
    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      res.status(404).json({ success: false, error: "Conversation not found." });
      return;
    }

    if (access.kind === "agent" && access.agentId) {
      if (!agentMayAccessConversation(conversation, access.agentId)) {
        res.status(404).json({ success: false, error: "Conversation not found." });
        return;
      }
    }

    const messageFilters: AgentMessageListFilters = { conversationId };
    if (limit !== undefined) messageFilters.limit = limit;
    if (offset !== undefined) messageFilters.offset = offset;
    if (after) messageFilters.after = after;

    const result = await listMessages(messageFilters);

    res.json({
      success: true,
      ...result,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list messages";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/agent-chat/conversations/:id/messages
 * Body: { content }
 */
router.post("/conversations/:id/messages", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveChatAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const conversationId = paramId(req.params.id);
  const parsed = parseMessageBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  const actor = await resolveActorForWrite(access, parsed.selfAgentId);
  if ("error" in actor) {
    res.status(actor.status).json({ success: false, error: actor.error });
    return;
  }

  try {
    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      res.status(404).json({ success: false, error: "Conversation not found." });
      return;
    }

    if (!agentMayAccessConversation(conversation, actor.actorId)) {
      res.status(403).json({
        success: false,
        error: "You are not a participant in this conversation.",
      });
      return;
    }

    const message = await sendMessage(
      conversationId,
      actor.actorId,
      parsed
    );

    res.status(201).json({
      success: true,
      data: message,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send message";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/agent-chat/conversations/:id/read
 * Marks all messages from the other participant as read for the current agent.
 */
router.post("/conversations/:id/read", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const access = await resolveChatAccess(auth.roles, auth.user.id);
  if ("error" in access) {
    res.status(access.status).json({ success: false, error: access.error });
    return;
  }

  const conversationId = paramId(req.params.id);
  const selfAgentId =
    req.body && typeof req.body === "object"
      ? optionalSelfAgentId(req.body as object)
      : undefined;

  const actor = await resolveActorForWrite(access, selfAgentId);
  if ("error" in actor) {
    res.status(actor.status).json({ success: false, error: actor.error });
    return;
  }

  try {
    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      res.status(404).json({ success: false, error: "Conversation not found." });
      return;
    }

    if (access.kind === "agent" && access.agentId) {
      if (!agentMayAccessConversation(conversation, access.agentId)) {
        res.status(404).json({ success: false, error: "Conversation not found." });
        return;
      }
    } else if (!agentMayAccessConversation(conversation, actor.actorId)) {
      res.status(403).json({
        success: false,
        error:
          "You are not a participant in this conversation. Send selfAgentId if using a separate agents row.",
      });
      return;
    }

    const marked = await markConversationRead(
      conversationId,
      actor.actorId
    );

    res.json({
      success: true,
      marked,
      access: access.kind,
      ...authExtras(res),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Failed to mark messages as read";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
