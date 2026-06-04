import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const CALL_CENTER_CHATS = "/api/call-center/chats";

function jsonWriteInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * GET /api/bms-black/chats/workshop-owners
 * Upstream: GET https://black.bmspros.com.au/api/call-center/chats/workshop-owners
 */
export async function proxyBlackCallCenterChatWorkshopOwners(
  firebaseIdToken: string,
  headerTenantId?: string
): Promise<Response> {
  const path = `${CALL_CENTER_CHATS}/workshop-owners`;
  const init: RequestInit & { tenantId?: string } = { method: "GET" };
  if (headerTenantId) init.tenantId = headerTenantId;
  return blackCallCenterFetch(path, firebaseIdToken, init);
}

/**
 * GET /api/bms-black/chats?limit=&ownerUid=&tenantId=
 * Upstream: GET https://black.bmspros.com.au/api/call-center/chats
 *
 * Returns the call-center 1:1 threads visible to the caller. Agents see chats where
 * `agentUid == them` (plus any pending queue rows their workshop scope allows).
 */
export async function proxyBlackCallCenterChatsList(
  firebaseIdToken: string,
  query: { limit?: string; ownerUid?: string; tenantId?: string },
  headerTenantId?: string
): Promise<Response> {
  const params = new URLSearchParams();
  if (query.limit?.trim()) params.set("limit", query.limit.trim());
  if (query.ownerUid?.trim()) params.set("ownerUid", query.ownerUid.trim());
  if (query.tenantId?.trim()) params.set("tenantId", query.tenantId.trim());
  const qs = params.toString();
  const path = qs ? `${CALL_CENTER_CHATS}?${qs}` : CALL_CENTER_CHATS;
  const init: RequestInit & { tenantId?: string } = { method: "GET" };
  if (headerTenantId) init.tenantId = headerTenantId;
  return blackCallCenterFetch(path, firebaseIdToken, init);
}

/**
 * POST /api/bms-black/chats/start-with-owner
 * Upstream: POST https://black.bmspros.com.au/api/call-center/chats/start-with-owner
 * Body: `{ "workshopOwnerUid": "...", "text": "optional first message" }`
 */
export async function proxyBlackCallCenterChatStartWithOwner(
  firebaseIdToken: string,
  body: unknown,
  headerTenantId?: string
): Promise<Response> {
  const path = `${CALL_CENTER_CHATS}/start-with-owner`;
  const init: RequestInit & { tenantId?: string } = {
    ...jsonWriteInit("POST", body),
  };
  if (headerTenantId) init.tenantId = headerTenantId;
  return blackCallCenterFetch(path, firebaseIdToken, init);
}

/**
 * GET /api/bms-black/chats/:chatId/messages?limit=&before=
 * Upstream: GET https://black.bmspros.com.au/api/call-center/chats/:chatId/messages
 */
export async function proxyBlackCallCenterChatMessages(
  firebaseIdToken: string,
  chatId: string,
  query: { limit?: string; before?: string },
  headerTenantId?: string
): Promise<Response> {
  const params = new URLSearchParams();
  if (query.limit?.trim()) params.set("limit", query.limit.trim());
  if (query.before?.trim()) params.set("before", query.before.trim());
  const qs = params.toString();
  const base = `${CALL_CENTER_CHATS}/${encodeURIComponent(chatId.trim())}/messages`;
  const path = qs ? `${base}?${qs}` : base;
  const init: RequestInit & { tenantId?: string } = { method: "GET" };
  if (headerTenantId) init.tenantId = headerTenantId;
  return blackCallCenterFetch(path, firebaseIdToken, init);
}

/**
 * POST /api/bms-black/chats/:chatId/close
 * Upstream: POST https://black.bmspros.com.au/api/call-center/chats/:chatId/close
 * Body (optional): `{ "farewellMessage": "..." }`
 */
export async function proxyBlackCallCenterChatClose(
  firebaseIdToken: string,
  chatId: string,
  body: unknown,
  headerTenantId?: string
): Promise<Response> {
  const path = `${CALL_CENTER_CHATS}/${encodeURIComponent(chatId.trim())}/close`;
  const init: RequestInit & { tenantId?: string } = {
    ...jsonWriteInit("POST", body ?? {}),
  };
  if (headerTenantId) init.tenantId = headerTenantId;
  return blackCallCenterFetch(path, firebaseIdToken, init);
}

/**
 * POST /api/bms-black/chats/:chatId/messages
 * Upstream: POST https://black.bmspros.com.au/api/call-center/chats/:chatId/messages
 * Body: `{ "text": "Thank you for contacting us." }`
 */
export async function proxyBlackCallCenterChatPostMessage(
  firebaseIdToken: string,
  chatId: string,
  body: unknown,
  headerTenantId?: string
): Promise<Response> {
  const path = `${CALL_CENTER_CHATS}/${encodeURIComponent(chatId.trim())}/messages`;
  const init: RequestInit & { tenantId?: string } = {
    ...jsonWriteInit("POST", body),
  };
  if (headerTenantId) init.tenantId = headerTenantId;
  return blackCallCenterFetch(path, firebaseIdToken, init);
}
