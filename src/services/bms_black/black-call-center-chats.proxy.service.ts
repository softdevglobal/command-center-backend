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
 * POST /api/bms-black/chats/:chatId/messages
 * Upstream: POST https://black.bmspros.com.au/api/call-center/chats/:chatId/messages
 * Body: `{ "text": "Thank you for contacting us." }`
 */
export async function proxyBlackCallCenterChatSendMessage(
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
