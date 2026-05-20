import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_BRANCHES_PATH = "/api/call-center/branches";

/**
 * GET /api/bms-black/branches?ownerUid=
 * Upstream: GET https://black.bmspros.com.au/api/call-center/branches?ownerUid=
 */
export async function proxyBlackCallCenterBranches(
  firebaseIdToken: string,
  tenantId: string,
  ownerUid: string
): Promise<Response> {
  const path = `${BLACK_BRANCHES_PATH}?ownerUid=${encodeURIComponent(ownerUid.trim())}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/**
 * GET /api/bms-black/branches/:branchId
 * Upstream: GET https://black.bmspros.com.au/api/call-center/branches/:branchId
 */
export async function proxyBlackCallCenterBranchById(
  firebaseIdToken: string,
  tenantId: string,
  branchId: string
): Promise<Response> {
  const path = `${BLACK_BRANCHES_PATH}/${encodeURIComponent(branchId.trim())}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}
