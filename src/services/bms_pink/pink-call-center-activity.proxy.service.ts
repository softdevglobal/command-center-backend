import {
  pinkCallCenterFetch,
  pinkJsonInit,
  withQuery,
} from "./pink-call-center.proxy.util.js";

const CUSTOMER_NOTIFICATIONS_PATH = "/api/call-center/customer-notifications";

/** `GET /api/call-center/customer-notifications?all=&unreadOnly=&limit=&sinceDays=` */
export async function proxyPinkCallCenterCustomerNotifications(
  firebaseIdToken: string,
  query: Record<string, string | undefined>,
  tenantId?: string
): Promise<Response> {
  const init: RequestInit & { tenantId?: string } = { method: "GET" };
  if (tenantId) init.tenantId = tenantId;
  return pinkCallCenterFetch(withQuery(CUSTOMER_NOTIFICATIONS_PATH, query), firebaseIdToken, init);
}

/** `POST /api/call-center/customer-notifications/:id/{notification-reviewed|called-customer}` */
export async function proxyPinkCallCenterNotificationTracking(
  firebaseIdToken: string,
  notificationId: string,
  kind: "notification-reviewed" | "called-customer",
  body: unknown
): Promise<Response> {
  const path = `${CUSTOMER_NOTIFICATIONS_PATH}/${encodeURIComponent(notificationId.trim())}/${kind}`;
  return pinkCallCenterFetch(path, firebaseIdToken, pinkJsonInit("POST", body));
}

/** `POST /api/call-center/agent-activities` (JSON body). */
export async function proxyPinkCallCenterAgentActivities(
  firebaseIdToken: string,
  body: unknown,
  tenantId?: string
): Promise<Response> {
  const init: RequestInit & { tenantId?: string } = pinkJsonInit("POST", body);
  if (tenantId) init.tenantId = tenantId;
  return pinkCallCenterFetch("/api/call-center/agent-activities", firebaseIdToken, init);
}

/** `GET /api/call-center/agent-activities?ownerId=&agentUserId=&branchId=&callId=&limit=` */
export async function proxyPinkCallCenterAgentActivitiesList(
  firebaseIdToken: string,
  query: Record<string, string | undefined>
): Promise<Response> {
  return pinkCallCenterFetch(
    withQuery("/api/call-center/agent-activities", query),
    firebaseIdToken,
    { method: "GET" }
  );
}
