import { blueCallCenterFetch } from "./blue-call-center.proxy.util.js";

/** Blue support-chat agent API base (see `BLUE_API_BASE_URL` for host override). */
const CHAT_CONVERSATIONS_AGENT = "/api/chat/conversations/agent";

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

/**
 * GET /api/bms-blue/agent/conversations?queueLimit=&mineLimit=
 * Upstream: GET {BLUE_API_BASE_URL}/api/chat/conversations/agent
 */
export async function proxyBlueSupportChatConversations(
  firebaseIdToken: string,
  query: { queueLimit?: string; mineLimit?: string }
): Promise<Response> {
  const path = appendQuery(CHAT_CONVERSATIONS_AGENT, {
    queueLimit: query.queueLimit,
    mineLimit: query.mineLimit,
  });
  return blueCallCenterFetch(path, firebaseIdToken, { method: "GET" });
}

/**
 * GET /api/bms-blue/agent/conversations/:conversationId/messages?limit=&before=
 * Upstream: GET .../api/chat/conversations/agent/:conversationId/messages
 */
export async function proxyBlueSupportChatMessages(
  firebaseIdToken: string,
  conversationId: string,
  query: { limit?: string; before?: string }
): Promise<Response> {
  const base = `${CHAT_CONVERSATIONS_AGENT}/${encodeURIComponent(conversationId.trim())}/messages`;
  const path = appendQuery(base, {
    limit: query.limit,
    before: query.before,
  });
  return blueCallCenterFetch(path, firebaseIdToken, { method: "GET" });
}

/**
 * POST /api/bms-blue/agent/conversations/:conversationId/messages
 * Upstream: POST .../api/chat/conversations/agent/:conversationId/messages
 */
export async function proxyBlueSupportChatSendMessage(
  firebaseIdToken: string,
  conversationId: string,
  body: unknown
): Promise<Response> {
  const path = `${CHAT_CONVERSATIONS_AGENT}/${encodeURIComponent(conversationId.trim())}/messages`;
  return blueCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * POST /api/bms-blue/agent/conversations/:conversationId/claim
 * Upstream: POST .../api/chat/conversations/agent/:conversationId/claim
 */
export async function proxyBlueSupportChatClaimConversation(
  firebaseIdToken: string,
  conversationId: string
): Promise<Response> {
  const path = `${CHAT_CONVERSATIONS_AGENT}/${encodeURIComponent(conversationId.trim())}/claim`;
  return blueCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

/**
 * POST /api/bms-blue/agent/conversations/:conversationId/read
 * Upstream: POST .../api/chat/conversations/agent/:conversationId/read
 */
export async function proxyBlueSupportChatMarkRead(
  firebaseIdToken: string,
  conversationId: string
): Promise<Response> {
  const path = `${CHAT_CONVERSATIONS_AGENT}/${encodeURIComponent(conversationId.trim())}/read`;
  return blueCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

/**
 * POST /api/bms-blue/agent/conversations/:conversationId/close
 * Upstream: POST .../api/chat/conversations/agent/:conversationId/close
 */
export async function proxyBlueSupportChatCloseConversation(
  firebaseIdToken: string,
  conversationId: string,
  body: unknown
): Promise<Response> {
  const path = `${CHAT_CONVERSATIONS_AGENT}/${encodeURIComponent(conversationId.trim())}/close`;
  return blueCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}
