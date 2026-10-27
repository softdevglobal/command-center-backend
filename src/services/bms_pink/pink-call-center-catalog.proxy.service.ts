import { pinkCallCenterFetch, withQuery } from "./pink-call-center.proxy.util.js";

/**
 * Read-only salon lookup data on BMS Pink: branches, services, staff.
 * All tenant-scoped via `X-Tenant-Id` (salon owner uid).
 */

/** `GET /api/call-center/branches?ownerUid=&date=` */
export async function proxyPinkCallCenterBranches(
  firebaseIdToken: string,
  tenantId: string,
  query: { ownerUid: string; date?: string }
): Promise<Response> {
  return pinkCallCenterFetch(withQuery("/api/call-center/branches", query), firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `GET /api/call-center/branches/:branchId?date=` */
export async function proxyPinkCallCenterBranchById(
  firebaseIdToken: string,
  tenantId: string,
  branchId: string,
  query: { date?: string }
): Promise<Response> {
  const path = withQuery(`/api/call-center/branches/${encodeURIComponent(branchId.trim())}`, query);
  return pinkCallCenterFetch(path, firebaseIdToken, { method: "GET", tenantId });
}

/** `GET /api/call-center/services?branchId=` */
export async function proxyPinkCallCenterServices(
  firebaseIdToken: string,
  tenantId: string,
  query: { branchId?: string }
): Promise<Response> {
  return pinkCallCenterFetch(withQuery("/api/call-center/services", query), firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `GET /api/call-center/services/:serviceId` */
export async function proxyPinkCallCenterServiceById(
  firebaseIdToken: string,
  tenantId: string,
  serviceId: string
): Promise<Response> {
  return pinkCallCenterFetch(
    `/api/call-center/services/${encodeURIComponent(serviceId.trim())}`,
    firebaseIdToken,
    { method: "GET", tenantId }
  );
}

/** `GET /api/call-center/services/:serviceId/staff?branchId=&date=` */
export async function proxyPinkCallCenterServiceStaff(
  firebaseIdToken: string,
  tenantId: string,
  serviceId: string,
  query: { branchId?: string; date?: string }
): Promise<Response> {
  const path = withQuery(
    `/api/call-center/services/${encodeURIComponent(serviceId.trim())}/staff`,
    query
  );
  return pinkCallCenterFetch(path, firebaseIdToken, { method: "GET", tenantId });
}

/** `GET /api/call-center/staff?branchId=&role=&status=` */
export async function proxyPinkCallCenterStaff(
  firebaseIdToken: string,
  tenantId: string,
  query: { branchId?: string; role?: string; status?: string }
): Promise<Response> {
  return pinkCallCenterFetch(withQuery("/api/call-center/staff", query), firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}
