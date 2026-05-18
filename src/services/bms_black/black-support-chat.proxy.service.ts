import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const SUPPORT_CHAT_AGENT = "/api/support-chat/agent";

function appendQuery(
  path: string,
  params: Record<string, string | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value?.trim()) search.set(key, value.trim());
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** `GET /api/support-chat/agent/conversations` */
export async function proxyBlackSupportChatConversations(
  firebaseIdToken: string,
  query: {
    queueLimit?: string;
    mineLimit?: string;
    ownerUid?: string;
    tenantId?: string;
  },
  headerTenantId?: string
): Promise<Response> {
  const path = appendQuery(`${SUPPORT_CHAT_AGENT}/conversations`, {
    queueLimit: query.queueLimit,
    mineLimit: query.mineLimit,
    ownerUid: query.ownerUid,
    tenantId: query.tenantId,
  });
  const init: RequestInit & { tenantId?: string } = { method: "GET" };
  if (headerTenantId) init.tenantId = headerTenantId;
  return blackCallCenterFetch(path, firebaseIdToken, init);
}

/** `GET /api/support-chat/agent/conversations/:conversationId/messages` */
export async function proxyBlackSupportChatMessages(
  firebaseIdToken: string,
  conversationId: string,
  query: { limit?: string; before?: string }
): Promise<Response> {
  const base = `${SUPPORT_CHAT_AGENT}/conversations/${encodeURIComponent(conversationId.trim())}/messages`;
  const path = appendQuery(base, {
    limit: query.limit,
    before: query.before,
  });
  return blackCallCenterFetch(path, firebaseIdToken, { method: "GET" });
}

/** `POST /api/support-chat/agent/conversations/:conversationId/messages` */
export async function proxyBlackSupportChatSendMessage(
  firebaseIdToken: string,
  conversationId: string,
  body: unknown
): Promise<Response> {
  const path = `${SUPPORT_CHAT_AGENT}/conversations/${encodeURIComponent(conversationId.trim())}/messages`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `POST /api/support-chat/agent/conversations/:conversationId/claim` */
export async function proxyBlackSupportChatClaimConversation(
  firebaseIdToken: string,
  conversationId: string,
  body: unknown
): Promise<Response> {
  const path = `${SUPPORT_CHAT_AGENT}/conversations/${encodeURIComponent(conversationId.trim())}/claim`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** `POST /api/support-chat/agent/conversations/:conversationId/read` */
export async function proxyBlackSupportChatMarkRead(
  firebaseIdToken: string,
  conversationId: string
): Promise<Response> {
  const path = `${SUPPORT_CHAT_AGENT}/conversations/${encodeURIComponent(conversationId.trim())}/read`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

/** `POST /api/support-chat/agent/conversations/:conversationId/close` */
export async function proxyBlackSupportChatCloseConversation(
  firebaseIdToken: string,
  conversationId: string,
  body: unknown
): Promise<Response> {
  const path = `${SUPPORT_CHAT_AGENT}/conversations/${encodeURIComponent(conversationId.trim())}/close`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}
