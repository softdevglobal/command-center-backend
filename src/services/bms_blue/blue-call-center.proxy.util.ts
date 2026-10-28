import { blueEndpoint } from "../../config/blue-api.js";

export type BlueFetchInit = RequestInit & { tenantId?: string };

export function normalizeFirebaseBearer(firebaseIdToken: string): string {
  return firebaseIdToken.replace(/^Bearer\s+/i, "").trim();
}

/** Bearer + optional `X-Tenant-Id` (Trade businessId). */
export function firebaseBlueHeaders(
  firebaseIdToken: string,
  tenantId?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${normalizeFirebaseBearer(firebaseIdToken)}`,
    Accept: "application/json",
  };
  const tid = tenantId?.trim();
  if (tid) {
    headers["X-Tenant-Id"] = tid;
  }
  return headers;
}

export function blueCallCenterFetch(
  path: string,
  firebaseIdToken: string,
  init?: BlueFetchInit
): Promise<Response> {
  const { tenantId, ...rest } = init ?? {};
  const headers = {
    ...firebaseBlueHeaders(firebaseIdToken, tenantId),
    ...(rest.headers as Record<string, string> | undefined),
  };
  return fetch(blueEndpoint(path), { ...rest, headers });
}

export function blueJsonInit(method: string, body: unknown, tenantId?: string): BlueFetchInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    ...(tenantId ? { tenantId } : {}),
  };
}

export function blueGetInit(tenantId?: string): BlueFetchInit {
  return { method: "GET", ...(tenantId ? { tenantId } : {}) };
}

export { withQuery } from "../bms_pink/pink-call-center.proxy.util.js";
