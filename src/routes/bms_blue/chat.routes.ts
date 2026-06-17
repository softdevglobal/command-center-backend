import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlueSupportChatClaimConversation,
  proxyBlueSupportChatCloseConversation,
  proxyBlueSupportChatConversations,
  proxyBlueSupportChatMarkRead,
  proxyBlueSupportChatMessages,
  proxyBlueSupportChatSendMessage,
} from "../../services/bms_blue/blue-support-chat.proxy.service.js";
import {
  resolveFirebaseBlueProxyContext,
  runBlueProxy,
  singleQuery,
} from "./blue-proxy.helpers.js";

const router = Router();

function conversationIdParam(raw: unknown): string {
  return String(raw ?? "").trim();
}

/**
 * Support chat — agent lists queue and assigned conversations.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://127.0.0.1:5050/api/bms-blue/agent/conversations?queueLimit=30&mineLimit=30
 * ──────────────────────────────────────────────────────────────────────────────
 * **Frontend auth:** `Authorization: Bearer <Supabase access_token>` from POST /api/auth/login
 * **Upstream Blue:** stored Firebase Blue idToken (bmspro-trade) from login store
 * **Upstream URL:** GET {BLUE_API_BASE_URL}/api/chat/conversations/agent
 *
 * Query:   queueLimit (default 30), mineLimit (default 30)
 * Body:    none
 *
 * Success — 200:
 *   { "ok": true, "queue": [...], "mine": [...] }
 *
 * Errors:
 *   { "ok": false, "error": "Call-center or super admin access required." }  403
 *
 * Flow:
 *   1. POST /api/auth/login (Command Center) — stores Firebase Blue idToken server-side
 *   2. GET  /api/bms-blue/agent/conversations (this route)
 *   3. POST /api/bms-blue/agent/conversations/:conversationId/claim
 *   4. POST /api/bms-blue/agent/conversations/:conversationId/messages
 *
 * Env: `BLUE_API_BASE_URL` (default http://127.0.0.1:3000), `FIREBASE_BLUE_WEB_API_KEY`
 */
router.get("/agent/conversations", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;

  const query: { queueLimit?: string; mineLimit?: string } = {};
  const queueLimit = singleQuery(req.query.queueLimit);
  const mineLimit = singleQuery(req.query.mineLimit);
  if (queueLimit) query.queueLimit = queueLimit;
  if (mineLimit) query.mineLimit = mineLimit;

  await runBlueProxy(res, () =>
    proxyBlueSupportChatConversations(ctx.firebaseIdToken, query)
  );
});

/**
 * Support chat — agent claims a waiting conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://127.0.0.1:5050/api/bms-blue/agent/conversations/{conversationId}/claim
 * ──────────────────────────────────────────────────────────────────────────────
 * **Frontend auth:** Bearer Supabase access_token
 * **Upstream:**      POST {BLUE_API_BASE_URL}/api/chat/conversations/agent/{conversationId}/claim
 * Body:              none
 *
 * Success — 200:
 *   { "ok": true, "conversation": { "status": "connected", "agentId", ... } }
 *
 * Errors:
 *   { "ok": false, "error": "Conversation is not available to claim." }  400
 *
 * Effect: status waiting → connected; system message sent to owner
 * Do this after: GET /api/bms-blue/agent/conversations (copy conversationId from queue)
 */
router.post(
  "/agent/conversations/:conversationId/claim",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = await resolveFirebaseBlueProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlueProxy(res, () =>
      proxyBlueSupportChatClaimConversation(
        ctx.firebaseIdToken,
        conversationId
      )
    );
  }
);

/**
 * Support chat — agent loads messages on a claimed conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://127.0.0.1:5050/api/bms-blue/agent/conversations/{conversationId}/messages?limit=40&before={messageId}
 * ──────────────────────────────────────────────────────────────────────────────
 * **Frontend auth:** Bearer Supabase access_token
 * **Upstream:**      GET .../api/chat/conversations/agent/{conversationId}/messages
 *
 * Query:  limit (default 40), before (pagination cursor)
 * Success — 200:  { "ok": true, "messages": [...] }
 *
 * Requires agent to have claimed the conversation first.
 */
router.get(
  "/agent/conversations/:conversationId/messages",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = await resolveFirebaseBlueProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    const query: { limit?: string; before?: string } = {};
    const limit = singleQuery(req.query.limit);
    const before = singleQuery(req.query.before);
    if (limit) query.limit = limit;
    if (before) query.before = before;

    await runBlueProxy(res, () =>
      proxyBlueSupportChatMessages(ctx.firebaseIdToken, conversationId, query)
    );
  }
);

/**
 * Support chat — agent sends a message on a claimed conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://127.0.0.1:5050/api/bms-blue/agent/conversations/{conversationId}/messages
 * ──────────────────────────────────────────────────────────────────────────────
 * **Frontend auth:** Bearer Supabase access_token
 * **Upstream:**      POST .../api/chat/conversations/agent/{conversationId}/messages
 *
 * Body:  { "message": "Hi, how can I help?" }
 * Success — 200:  { "ok": true, "messageId": "..." }
 *
 * The owner should see the reply in the chat widget in real time.
 */
router.post(
  "/agent/conversations/:conversationId/messages",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = await resolveFirebaseBlueProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlueProxy(res, () =>
      proxyBlueSupportChatSendMessage(
        ctx.firebaseIdToken,
        conversationId,
        req.body
      )
    );
  }
);

/**
 * Support chat — agent marks customer messages as read.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://127.0.0.1:5050/api/bms-blue/agent/conversations/{conversationId}/read
 * ──────────────────────────────────────────────────────────────────────────────
 * **Frontend auth:** Bearer Supabase access_token
 * **Upstream:**      POST .../api/chat/conversations/agent/{conversationId}/read
 * Body:              none
 *
 * Success — 200:  { "ok": true }
 * Firestore:      messages.readByAgent + unreadForAgent cleared on parent doc
 */
router.post(
  "/agent/conversations/:conversationId/read",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = await resolveFirebaseBlueProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlueProxy(res, () =>
      proxyBlueSupportChatMarkRead(ctx.firebaseIdToken, conversationId)
    );
  }
);

/**
 * Support chat — agent closes a conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://127.0.0.1:5050/api/bms-blue/agent/conversations/{conversationId}/close
 * ──────────────────────────────────────────────────────────────────────────────
 * **Frontend auth:** Bearer Supabase access_token
 * **Upstream:**      POST .../api/chat/conversations/agent/{conversationId}/close
 *
 * Body (optional):  { "farewellMessage": "Thanks for contacting us!" }
 * Success — 200:   { "ok": true }
 * Effect:          status → closed; owner's next message starts a new conversation
 */
router.post(
  "/agent/conversations/:conversationId/close",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = await resolveFirebaseBlueProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlueProxy(res, () =>
      proxyBlueSupportChatCloseConversation(
        ctx.firebaseIdToken,
        conversationId,
        req.body
      )
    );
  }
);

export default router;
