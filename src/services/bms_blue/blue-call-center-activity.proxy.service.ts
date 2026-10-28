import {
  blueCallCenterFetch,
  blueGetInit,
  blueJsonInit,
  withQuery,
} from "./blue-call-center.proxy.util.js";

/** Customer inbox follow-up and call logs on BMS Trade. */

/** `GET /api/call-center/customer-notifications?all=&unreadOnly=&limit=&sinceDays=` */
export async function proxyBlueCallCenterCustomerNotifications(
  firebaseIdToken: string,
  query: Record<string, string | undefined>,
  tenantId?: string
): Promise<Response> {
  return blueCallCenterFetch(
    withQuery("/api/call-center/customer-notifications", query),
    firebaseIdToken,
    blueGetInit(tenantId)
  );
}

/** `POST /api/call-center/customer-notifications/:id/{notification-reviewed|called-customer}` */
export async function proxyBlueCallCenterNotificationTracking(
  firebaseIdToken: string,
  notificationId: string,
  kind: "notification-reviewed" | "called-customer",
  body: unknown
): Promise<Response> {
  return blueCallCenterFetch(
    `/api/call-center/customer-notifications/${encodeURIComponent(notificationId.trim())}/${kind}`,
    firebaseIdToken,
    blueJsonInit("POST", body)
  );
}

/** `POST /api/call-center/agent-activities` — log a call. */
export async function proxyBlueCallCenterAgentActivities(
  firebaseIdToken: string,
  body: unknown,
  tenantId?: string
): Promise<Response> {
  return blueCallCenterFetch("/api/call-center/agent-activities", firebaseIdToken, blueJsonInit("POST", body, tenantId));
}

/** `GET /api/call-center/agent-activities?businessId=&agentUserId=&agentEmail=&callId=&limit=` */
export async function proxyBlueCallCenterAgentActivitiesList(
  firebaseIdToken: string,
  query: Record<string, string | undefined>,
  tenantId?: string
): Promise<Response> {
  return blueCallCenterFetch(
    withQuery("/api/call-center/agent-activities", query),
    firebaseIdToken,
    blueGetInit(tenantId)
  );
}
