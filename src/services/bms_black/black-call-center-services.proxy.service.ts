import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_SERVICES_PATH = "/api/call-center/services";

/** `GET /api/call-center/services` */
export async function proxyBlackCallCenterServices(
  firebaseIdToken: string,
  tenantId: string
): Promise<Response> {
  return blackCallCenterFetch(BLACK_SERVICES_PATH, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `GET /api/call-center/services?branchId=...` */
export async function proxyBlackCallCenterServicesByBranch(
  firebaseIdToken: string,
  tenantId: string,
  branchId: string
): Promise<Response> {
  const path = `${BLACK_SERVICES_PATH}?branchId=${encodeURIComponent(branchId.trim())}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `GET /api/call-center/services/:id` */
export async function proxyBlackCallCenterServiceById(
  firebaseIdToken: string,
  tenantId: string,
  serviceId: string
): Promise<Response> {
  const path = `${BLACK_SERVICES_PATH}/${encodeURIComponent(serviceId.trim())}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `GET /api/call-center/services/:serviceId/staff` */
export async function proxyBlackCallCenterServiceStaff(
  firebaseIdToken: string,
  tenantId: string,
  serviceId: string,
  query: { branchId: string; date: string }
): Promise<Response> {
  const path = `${BLACK_SERVICES_PATH}/${encodeURIComponent(serviceId.trim())}/staff?branchId=${encodeURIComponent(query.branchId)}&date=${encodeURIComponent(query.date)}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}
