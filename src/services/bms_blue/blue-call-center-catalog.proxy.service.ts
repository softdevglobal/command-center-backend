import { blueCallCenterFetch, blueGetInit, withQuery } from "./blue-call-center.proxy.util.js";

/**
 * Read-only business lookup data on BMS Trade: workshops (businesses),
 * services and staff. Business-scoped calls send `X-Tenant-Id` (businessId).
 */

/** `GET /api/call-center/workshops?summary=1` — businesses the agent can work with. */
export async function proxyBlueCallCenterWorkshops(
  firebaseIdToken: string,
  query: { summary?: string }
): Promise<Response> {
  return blueCallCenterFetch(withQuery("/api/call-center/workshops", query), firebaseIdToken, blueGetInit());
}

/** `GET /api/call-center/services?activeOnly=` */
export async function proxyBlueCallCenterServices(
  firebaseIdToken: string,
  tenantId: string,
  query: { activeOnly?: string }
): Promise<Response> {
  return blueCallCenterFetch(withQuery("/api/call-center/services", query), firebaseIdToken, blueGetInit(tenantId));
}

/** `GET /api/call-center/services/:serviceId` */
export async function proxyBlueCallCenterServiceById(
  firebaseIdToken: string,
  tenantId: string,
  serviceId: string
): Promise<Response> {
  return blueCallCenterFetch(
    `/api/call-center/services/${encodeURIComponent(serviceId.trim())}`,
    firebaseIdToken,
    blueGetInit(tenantId)
  );
}

/** `GET /api/call-center/services/:serviceId/staff?date=` */
export async function proxyBlueCallCenterServiceStaff(
  firebaseIdToken: string,
  tenantId: string,
  serviceId: string,
  query: { date?: string }
): Promise<Response> {
  const path = withQuery(`/api/call-center/services/${encodeURIComponent(serviceId.trim())}/staff`, query);
  return blueCallCenterFetch(path, firebaseIdToken, blueGetInit(tenantId));
}

/** `GET /api/call-center/staff?status=` */
export async function proxyBlueCallCenterStaff(
  firebaseIdToken: string,
  tenantId: string,
  query: { status?: string }
): Promise<Response> {
  return blueCallCenterFetch(withQuery("/api/call-center/staff", query), firebaseIdToken, blueGetInit(tenantId));
}
