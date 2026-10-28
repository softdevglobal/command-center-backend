import {
  blueCallCenterFetch,
  blueGetInit,
  blueJsonInit,
  withQuery,
} from "./blue-call-center.proxy.util.js";

/**
 * Call-center direct chat on BMS Trade (agent ↔ business owner, `cc_…` ids).
 * Upstream: `/api/call-center/chats/*` (same handlers as Trade's `/api/chat/cc-direct/agent/*`).
 * Support chat lives in `blue-support-chat.proxy.service.ts`.
 */
const CALL_CENTER_CHATS = "/api/call-center/chats";

function chatPath(chatId: string, suffix: string): string {
  return `${CALL_CENTER_CHATS}/${encodeURIComponent(chatId.trim())}/${suffix}`;
}

/** `GET /api/call-center/chats?limit=` — `{ ok, assigned: [...], queue: [...] }` */
export async function proxyBlueCallCenterChatsList(
  firebaseIdToken: string,
  query: { limit?: string }
): Promise<Response> {
  return blueCallCenterFetch(withQuery(CALL_CENTER_CHATS, query), firebaseIdToken, blueGetInit());
}

/** `GET /api/call-center/chats/workshop-owners` */
export async function proxyBlueCallCenterChatWorkshopOwners(firebaseIdToken: string): Promise<Response> {
  return blueCallCenterFetch(`${CALL_CENTER_CHATS}/workshop-owners`, firebaseIdToken, blueGetInit());
}

/** `POST /api/call-center/chats/start-with-owner` */
export async function proxyBlueCallCenterChatStartWithOwner(
  firebaseIdToken: string,
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(`${CALL_CENTER_CHATS}/start-with-owner`, firebaseIdToken, blueJsonInit("POST", body));
}

/** `GET /api/call-center/chats/:chatId/messages?limit=&before=` */
export async function proxyBlueCallCenterChatMessages(
  firebaseIdToken: string,
  chatId: string,
  query: { limit?: string; before?: string }
): Promise<Response> {
  return blueCallCenterFetch(withQuery(chatPath(chatId, "messages"), query), firebaseIdToken, blueGetInit());
}

/** `POST /api/call-center/chats/:chatId/{messages|claim|close|read}` */
export async function proxyBlueCallCenterChatAction(
  firebaseIdToken: string,
  chatId: string,
  action: "messages" | "claim" | "close" | "read",
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(chatPath(chatId, action), firebaseIdToken, blueJsonInit("POST", body));
}

/** `PATCH /api/call-center/chats/:chatId/reviewed` */
export async function proxyBlueCallCenterChatReviewed(
  firebaseIdToken: string,
  chatId: string,
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(chatPath(chatId, "reviewed"), firebaseIdToken, blueJsonInit("PATCH", body));
}
