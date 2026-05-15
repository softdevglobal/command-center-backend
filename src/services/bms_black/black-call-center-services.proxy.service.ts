import { blackEndpoint } from "../../config/black-api.js";

const BLACK_SERVICES_PATH = "/api/call-center/services";

function fetchBlackServices(
  firebaseIdToken: string,
  tenantId: string,
  branchId?: string
): Promise<Response> {
  const token = firebaseIdToken.replace(/^Bearer\s+/i, "").trim();
  const tid = tenantId.trim();
  const url = new URL(blackEndpoint(BLACK_SERVICES_PATH));
  const bid = branchId?.trim();
  if (bid) {
    url.searchParams.set("branchId", bid);
  }
  return fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tid,
      Accept: "application/json",
    },
  });
}

/**
 * Proxies to BMS Black `GET /api/call-center/services`.
 */
export async function proxyBlackCallCenterServices(
  firebaseIdToken: string,
  tenantId: string
): Promise<Response> {
  return fetchBlackServices(firebaseIdToken, tenantId);
}

/**
 * Proxies to BMS Black `GET /api/call-center/services?branchId=...`.
 */
export async function proxyBlackCallCenterServicesByBranch(
  firebaseIdToken: string,
  tenantId: string,
  branchId: string
): Promise<Response> {
  return fetchBlackServices(firebaseIdToken, tenantId, branchId);
}

/**
 * Proxies to BMS Black `GET /api/call-center/services/:id`.
 */
export async function proxyBlackCallCenterServiceById(
  firebaseIdToken: string,
  tenantId: string,
  serviceId: string
): Promise<Response> {
  const token = firebaseIdToken.replace(/^Bearer\s+/i, "").trim();
  const tid = tenantId.trim();
  const id = serviceId.trim();
  const path = `${BLACK_SERVICES_PATH}/${encodeURIComponent(id)}`;
  const url = blackEndpoint(path);
  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Id": tid,
      Accept: "application/json",
    },
  });
}
