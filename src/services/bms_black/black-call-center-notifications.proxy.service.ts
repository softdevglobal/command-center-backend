import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_CUSTOMER_NOTIFICATIONS_PATH =
  "/api/call-center/customer-notifications";

/** `GET /api/call-center/customer-notifications` */
export async function proxyBlackCallCenterCustomerNotifications(
  firebaseIdToken: string,
  query: { all?: string }
): Promise<Response> {
  const params = new URLSearchParams();
  if (query.all?.trim()) params.set("all", query.all.trim());
  const qs = params.toString();
  const path = qs
    ? `${BLACK_CUSTOMER_NOTIFICATIONS_PATH}?${qs}`
    : BLACK_CUSTOMER_NOTIFICATIONS_PATH;
  return blackCallCenterFetch(path, firebaseIdToken, { method: "GET" });
}

/** `POST /api/call-center/customer-notifications/:notificationId/notification-reviewed` */
export async function proxyBlackCallCenterNotificationReviewed(
  firebaseIdToken: string,
  notificationId: string,
  body: unknown
): Promise<Response> {
  const path = `${BLACK_CUSTOMER_NOTIFICATIONS_PATH}/${encodeURIComponent(notificationId.trim())}/notification-reviewed`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** `POST /api/call-center/customer-notifications/:notificationId/called-customer` */
export async function proxyBlackCallCenterNotificationCalledCustomer(
  firebaseIdToken: string,
  notificationId: string,
  body: unknown
): Promise<Response> {
  const path = `${BLACK_CUSTOMER_NOTIFICATIONS_PATH}/${encodeURIComponent(notificationId.trim())}/called-customer`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}
