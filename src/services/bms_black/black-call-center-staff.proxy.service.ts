import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_STAFF_PATH = "/api/call-center/staff";

/** `GET /api/call-center/staff` */
export async function proxyBlackCallCenterStaff(
  firebaseIdToken: string,
  tenantId: string,
  query: { branchId?: string; role?: string; status?: string }
): Promise<Response> {
  const params = new URLSearchParams();
  if (query.branchId?.trim()) params.set("branchId", query.branchId.trim());
  if (query.role?.trim()) params.set("role", query.role.trim());
  if (query.status?.trim()) params.set("status", query.status.trim());
  const qs = params.toString();
  const path = qs ? `${BLACK_STAFF_PATH}?${qs}` : BLACK_STAFF_PATH;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}
