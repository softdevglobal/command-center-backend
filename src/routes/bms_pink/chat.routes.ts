import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyPinkCallCenterChatAction,
  proxyPinkCallCenterChatMessages,
  proxyPinkCallCenterChatStartWithOwner,
  proxyPinkCallCenterChatWorkshopOwners,
  proxyPinkCallCenterChatsList,
  proxyPinkSupportChatAction,
  proxyPinkSupportChatConversations,
  proxyPinkSupportChatMessages,
} from "../../services/bms_pink/pink-chats.proxy.service.js";
import {
  optionalTenantId,
  pickQuery,
  requiredParam,
  resolveFirebasePinkProxyContext,
  runPinkProxy,
} from "./pink-proxy.helpers.js";

const router = Router();

// ── Support chat (salon users ↔ support queue) ───────────────────────────────

/**
 * GET /api/bms-pink/agent/conversations?queueLimit=&mineLimit=
 * Upstream: GET /api/support-chat/agent/conversations — `{ queue: [...], mine: [...] }`.
 */
router.get("/agent/conversations", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["queueLimit", "mineLimit", "ownerUid", "tenantId"]);
  await runPinkProxy(res, () =>
    proxyPinkSupportChatConversations(ctx.firebaseIdToken, query, optionalTenantId(req))
  );
});

/** GET /api/bms-pink/agent/conversations/:conversationId/messages?limit=&before= */
router.get("/agent/conversations/:conversationId/messages", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const conversationId = requiredParam(res, req.params.conversationId, "conversation id");
  if (!conversationId) return;
  await runPinkProxy(res, () =>
    proxyPinkSupportChatMessages(ctx.firebaseIdToken, conversationId, pickQuery(req, ["limit", "before"]))
  );
});

/**
 * POST /api/bms-pink/agent/conversations/:conversationId/messages  `{ "message": "..." }`
 * POST /api/bms-pink/agent/conversations/:conversationId/claim
 * POST /api/bms-pink/agent/conversations/:conversationId/read
 * POST /api/bms-pink/agent/conversations/:conversationId/close     `{ "farewellMessage"?: "..." }`
 */
for (const action of ["messages", "claim", "read", "close"] as const) {
  router.post(`/agent/conversations/:conversationId/${action}`, attachSupabaseUser, async (req, res) => {
    const ctx = await resolveFirebasePinkProxyContext(res);
    if (!ctx) return;
    const conversationId = requiredParam(res, req.params.conversationId, "conversation id");
    if (!conversationId) return;
    await runPinkProxy(res, () =>
      proxyPinkSupportChatAction(ctx.firebaseIdToken, conversationId, action, req.body)
    );
  });
}

// ── Call-center direct chat (agent ↔ salon owner, `cc_…` ids) ────────────────

/** GET /api/bms-pink/chats?limit=&ownerUid=&tenantId= */
router.get("/chats", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["limit", "ownerUid", "tenantId"]);
  await runPinkProxy(res, () =>
    proxyPinkCallCenterChatsList(ctx.firebaseIdToken, query, optionalTenantId(req))
  );
});

/** GET /api/bms-pink/chats/workshop-owners — active salon owners the agent can message. */
router.get("/chats/workshop-owners", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterChatWorkshopOwners(ctx.firebaseIdToken, optionalTenantId(req))
  );
});

/** POST /api/bms-pink/chats/start-with-owner  `{ "workshopOwnerUid": "...", "text"?: "..." }` */
router.post("/chats/start-with-owner", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const body = req.body && typeof req.body === "object" ? (req.body as { workshopOwnerUid?: string }) : {};
  if (!String(body.workshopOwnerUid ?? "").trim()) {
    res.status(400).json({ error: "Missing required body field workshopOwnerUid." });
    return;
  }
  await runPinkProxy(res, () =>
    proxyPinkCallCenterChatStartWithOwner(ctx.firebaseIdToken, req.body, optionalTenantId(req))
  );
});

/** GET /api/bms-pink/chats/:chatId/messages?limit=&before= */
router.get("/chats/:chatId/messages", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const chatId = requiredParam(res, req.params.chatId, "chat id");
  if (!chatId) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterChatMessages(
      ctx.firebaseIdToken,
      chatId,
      pickQuery(req, ["limit", "before"]),
      optionalTenantId(req)
    )
  );
});

/**
 * POST /api/bms-pink/chats/:chatId/messages  `{ "text": "..." }`
 * POST /api/bms-pink/chats/:chatId/close
 */
for (const action of ["messages", "close"] as const) {
  router.post(`/chats/:chatId/${action}`, attachSupabaseUser, async (req, res) => {
    const ctx = await resolveFirebasePinkProxyContext(res);
    if (!ctx) return;
    const chatId = requiredParam(res, req.params.chatId, "chat id");
    if (!chatId) return;
    await runPinkProxy(res, () =>
      proxyPinkCallCenterChatAction(ctx.firebaseIdToken, chatId, action, req.body, optionalTenantId(req))
    );
  });
}

export default router;
