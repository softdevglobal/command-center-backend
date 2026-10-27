import {
  pinkCallCenterFetch,
  pinkJsonInit,
  withQuery,
} from "./pink-call-center.proxy.util.js";

/**
 * Two chat systems on BMS Pink:
 *  - `/api/support-chat/agent/*` — salon users ↔ support queue (conversation ids).
 *  - `/api/call-center/chats/*`  — agent ↔ salon owner direct chat (`cc_…` chat ids).
 */
const SUPPORT_CHAT_AGENT = "/api/support-chat/agent/conversations";
const CALL_CENTER_CHATS = "/api/call-center/chats";

function conversationPath(conversationId: string, suffix: string): string {
  return `${SUPPORT_CHAT_AGENT}/${encodeURIComponent(conversationId.trim())}/${suffix}`;
}

function chatPath(chatId: string, suffix: string): string {
  return `${CALL_CENTER_CHATS}/${encodeURIComponent(chatId.trim())}/${suffix}`;
}

function getInit(tenantId?: string): RequestInit & { tenantId?: string } {
  const init: RequestInit & { tenantId?: string } = { method: "GET" };
  if (tenantId) init.tenantId = tenantId;
  return init;
}

function postInit(body: unknown, tenantId?: string): RequestInit & { tenantId?: string } {
  const init: RequestInit & { tenantId?: string } = pinkJsonInit("POST", body);
  if (tenantId) init.tenantId = tenantId;
  return init;
}

// ── Support chat (agent side) ────────────────────────────────────────────────

/** `GET /api/support-chat/agent/conversations?queueLimit=&mineLimit=` */
export async function proxyPinkSupportChatConversations(
  firebaseIdToken: string,
  query: Record<string, string | undefined>,
  tenantId?: string
): Promise<Response> {
  return pinkCallCenterFetch(withQuery(SUPPORT_CHAT_AGENT, query), firebaseIdToken, getInit(tenantId));
}

/** `GET /api/support-chat/agent/conversations/:id/messages?limit=&before=` */
export async function proxyPinkSupportChatMessages(
  firebaseIdToken: string,
  conversationId: string,
  query: { limit?: string; before?: string }
): Promise<Response> {
  return pinkCallCenterFetch(
    withQuery(conversationPath(conversationId, "messages"), query),
    firebaseIdToken,
    getInit()
  );
}

/** `POST /api/support-chat/agent/conversations/:id/{messages|claim|read|close}` */
export async function proxyPinkSupportChatAction(
  firebaseIdToken: string,
  conversationId: string,
  action: "messages" | "claim" | "read" | "close",
  body: unknown
): Promise<Response> {
  return pinkCallCenterFetch(conversationPath(conversationId, action), firebaseIdToken, postInit(body));
}

// ── Call-center direct chat ──────────────────────────────────────────────────

/** `GET /api/call-center/chats?limit=&ownerUid=&tenantId=` */
export async function proxyPinkCallCenterChatsList(
  firebaseIdToken: string,
  query: Record<string, string | undefined>,
  tenantId?: string
): Promise<Response> {
  return pinkCallCenterFetch(withQuery(CALL_CENTER_CHATS, query), firebaseIdToken, getInit(tenantId));
}

/** `GET /api/call-center/chats/workshop-owners` */
export async function proxyPinkCallCenterChatWorkshopOwners(
  firebaseIdToken: string,
  tenantId?: string
): Promise<Response> {
  return pinkCallCenterFetch(`${CALL_CENTER_CHATS}/workshop-owners`, firebaseIdToken, getInit(tenantId));
}

/** `POST /api/call-center/chats/start-with-owner` — `{ workshopOwnerUid, text? }` */
export async function proxyPinkCallCenterChatStartWithOwner(
  firebaseIdToken: string,
  body: unknown,
  tenantId?: string
): Promise<Response> {
  return pinkCallCenterFetch(`${CALL_CENTER_CHATS}/start-with-owner`, firebaseIdToken, postInit(body, tenantId));
}

/** `GET /api/call-center/chats/:chatId/messages?limit=&before=` */
export async function proxyPinkCallCenterChatMessages(
  firebaseIdToken: string,
  chatId: string,
  query: { limit?: string; before?: string },
  tenantId?: string
): Promise<Response> {
  return pinkCallCenterFetch(withQuery(chatPath(chatId, "messages"), query), firebaseIdToken, getInit(tenantId));
}

/** `POST /api/call-center/chats/:chatId/{messages|close}` */
export async function proxyPinkCallCenterChatAction(
  firebaseIdToken: string,
  chatId: string,
  action: "messages" | "close",
  body: unknown,
  tenantId?: string
): Promise<Response> {
  return pinkCallCenterFetch(chatPath(chatId, action), firebaseIdToken, postInit(body, tenantId));
}
