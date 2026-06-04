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
  proxyBlackCallCenterChatClose,
  proxyBlackCallCenterChatMessages,
  proxyBlackCallCenterChatPostMessage,
  proxyBlackCallCenterChatsList,
  proxyBlackCallCenterChatStartWithOwner,
  proxyBlackCallCenterChatWorkshopOwners,
} from "../../services/bms_black/black-call-center-chats.proxy.service.js";
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
  const ctx = await resolveFirebaseBlackProxyContext(res);
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
    const ctx = await resolveFirebaseBlackProxyContext(res);
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
    const ctx = await resolveFirebaseBlackProxyContext(res);
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
    const ctx = await resolveFirebaseBlackProxyContext(res);
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
    const ctx = await resolveFirebaseBlackProxyContext(res);
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
    const ctx = await resolveFirebaseBlackProxyContext(res);
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

function chatIdParam(raw: unknown): string {
  return String(raw ?? "").trim();
}

/**
 * GET /api/bms-black/chats?limit=&ownerUid=&tenantId=
 * Upstream: GET https://black.bmspros.com.au/api/call-center/chats
 *
 * Lists call-center 1:1 chats visible to the caller (agents: their assigned chats + pending queue).
 * Used by the inbox so a started workshop chat stays reachable from the chat list.
 */
router.get("/chats", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const query: { limit?: string; ownerUid?: string; tenantId?: string } = {};
  const limit = singleQuery(req.query.limit);
  const ownerUid = singleQuery(req.query.ownerUid);
  const tenantId = singleQuery(req.query.tenantId);
  if (limit) query.limit = limit;
  if (ownerUid) query.ownerUid = ownerUid;
  if (tenantId) query.tenantId = tenantId;

  await runBlackProxy(res, () =>
    proxyBlackCallCenterChatsList(
      ctx.firebaseIdToken,
      query,
      optionalTenantId(req)
    )
  );
});

/**
 * GET /api/bms-black/chats/workshop-owners
 * Upstream: GET https://black.bmspros.com.au/api/call-center/chats/workshop-owners
 * Headers: Authorization (Supabase Bearer); optional X-Tenant-Id.
 */
router.get("/chats/workshop-owners", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  await runBlackProxy(res, () =>
    proxyBlackCallCenterChatWorkshopOwners(
      ctx.firebaseIdToken,
      optionalTenantId(req)
    )
  );
});

/**
 * POST /api/bms-black/chats/start-with-owner
 * Upstream: POST https://black.bmspros.com.au/api/call-center/chats/start-with-owner
 * Body: `{ "workshopOwnerUid": "<owner Firebase uid>", "text": "optional first message" }`
 * Headers: Authorization; optional X-Tenant-Id.
 */
router.post("/chats/start-with-owner", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const body =
    req.body && typeof req.body === "object"
      ? (req.body as { workshopOwnerUid?: string })
      : {};
  if (!String(body.workshopOwnerUid ?? "").trim()) {
    res.status(400).json({ error: "Missing required body field workshopOwnerUid." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterChatStartWithOwner(
      ctx.firebaseIdToken,
      req.body,
      optionalTenantId(req)
    )
  );
});

/**
 * GET /api/bms-black/chats/:chatId/messages?limit=&before=
 * Upstream: GET https://black.bmspros.com.au/api/call-center/chats/:chatId/messages
 * Headers: Authorization; optional X-Tenant-Id.
 */
router.get("/chats/:chatId/messages", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const chatId = chatIdParam(req.params.chatId);
  if (!chatId) {
    res.status(400).json({ error: "Missing chat id." });
    return;
  }

  const query: { limit?: string; before?: string } = {};
  const limit = singleQuery(req.query.limit);
  const before = singleQuery(req.query.before);
  if (limit) query.limit = limit;
  if (before) query.before = before;

  await runBlackProxy(res, () =>
    proxyBlackCallCenterChatMessages(
      ctx.firebaseIdToken,
      chatId,
      query,
      optionalTenantId(req)
    )
  );
});

/**
 * POST /api/bms-black/chats/:chatId/messages
 * Upstream: POST https://black.bmspros.com.au/api/call-center/chats/:chatId/messages
 * Body: `{ "text": "Thank you for contacting us." }`
 * Headers: Authorization; optional X-Tenant-Id.
 */
router.post("/chats/:chatId/messages", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const chatId = chatIdParam(req.params.chatId);
  if (!chatId) {
    res.status(400).json({ error: "Missing chat id." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterChatPostMessage(
      ctx.firebaseIdToken,
      chatId,
      req.body,
      optionalTenantId(req)
    )
  );
});

/**
 * POST /api/bms-black/chats/:chatId/close
 * Upstream: POST https://black.bmspros.com.au/api/call-center/chats/:chatId/close
 * Body (optional): `{ "farewellMessage": "Thanks for contacting us" }`
 * Headers: Authorization; optional X-Tenant-Id.
 *
 * Use for **call-center** chat ids (`cc_...`). Do not use `/agent/conversations/.../close`
 * — that is support-chat only (different conversation ids).
 */
router.post("/chats/:chatId/close", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const chatId = chatIdParam(req.params.chatId);
  if (!chatId) {
    res.status(400).json({ error: "Missing chat id." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterChatClose(
      ctx.firebaseIdToken,
      chatId,
      req.body,
      optionalTenantId(req)
    )
  );
});

export default router;