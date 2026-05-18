import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlackSupportChatClaimConversation,
  proxyBlackSupportChatCloseConversation,
  proxyBlackSupportChatConversations,
  proxyBlackSupportChatMarkRead,
  proxyBlackSupportChatMessages,
  proxyBlackSupportChatSendMessage,
} from "../../services/bms_black/black-support-chat.proxy.service.js";
import {
  optionalTenantId,
  resolveFirebaseBlackProxyContext,
  runBlackProxy,
  singleQuery,
} from "./black-proxy.helpers.js";

const router = Router();

function conversationIdParam(raw: unknown): string {
  return String(raw ?? "").trim();
}

/**
 * GET /api/bms-black/agent/conversations?queueLimit=&mineLimit=&ownerUid=&tenantId=
 *
 * **Frontend:** `Authorization: Bearer <Supabase access_token>` from login.
 * **Upstream Black:** stored Firebase idToken; `X-Tenant-Id` header optional.
 */
router.get("/agent/conversations", attachSupabaseUser, async (req, res) => {
  const ctx = resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const query: {
    queueLimit?: string;
    mineLimit?: string;
    ownerUid?: string;
    tenantId?: string;
  } = {};
  const queueLimit = singleQuery(req.query.queueLimit);
  const mineLimit = singleQuery(req.query.mineLimit);
  const ownerUid = singleQuery(req.query.ownerUid);
  const tenantId = singleQuery(req.query.tenantId);
  if (queueLimit) query.queueLimit = queueLimit;
  if (mineLimit) query.mineLimit = mineLimit;
  if (ownerUid) query.ownerUid = ownerUid;
  if (tenantId) query.tenantId = tenantId;

  const headerTenant = optionalTenantId(req);

  await runBlackProxy(res, () =>
    proxyBlackSupportChatConversations(
      ctx.firebaseIdToken,
      query,
      headerTenant
    )
  );
});

/**
 * GET /api/bms-black/agent/conversations/:conversationId/messages?limit=&before=
 * Upstream: paginated chat history; `X-Tenant-Id` not required.
 */
router.get(
  "/agent/conversations/:conversationId/messages",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
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

    await runBlackProxy(res, () =>
      proxyBlackSupportChatMessages(
        ctx.firebaseIdToken,
        conversationId,
        query
      )
    );
  }
);

/**
 * POST /api/bms-black/agent/conversations/:conversationId/messages
 * Body: `{ "message": "Hello customer" }`
 */
router.post(
  "/agent/conversations/:conversationId/messages",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackSupportChatSendMessage(
        ctx.firebaseIdToken,
        conversationId,
        req.body
      )
    );
  }
);

/**
 * POST /api/bms-black/agent/conversations/:conversationId/claim
 * Assigns chat to current agent (queue → mine).
 */
router.post(
  "/agent/conversations/:conversationId/claim",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackSupportChatClaimConversation(
        ctx.firebaseIdToken,
        conversationId,
        req.body
      )
    );
  }
);

/**
 * POST /api/bms-black/agent/conversations/:conversationId/read
 * Clears unread / marks messages seen.
 */
router.post(
  "/agent/conversations/:conversationId/read",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackSupportChatMarkRead(ctx.firebaseIdToken, conversationId)
    );
  }
);

/**
 * POST /api/bms-black/agent/conversations/:conversationId/close
 * Body (optional): `{ "farewellMessage": "Thanks for contacting us" }`
 */
router.post(
  "/agent/conversations/:conversationId/close",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const conversationId = conversationIdParam(req.params.conversationId);
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversation id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackSupportChatCloseConversation(
        ctx.firebaseIdToken,
        conversationId,
        req.body
      )
    );
  }
);

export default router;
