import { blackEndpoint } from "../../config/black-api.js";

export function normalizeFirebaseBearer(firebaseIdToken: string): string {
  return firebaseIdToken.replace(/^Bearer\s+/i, "").trim();
}

export function firebaseBlackHeaders(
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

export function blackCallCenterFetch(
  path: string,
  firebaseIdToken: string,
  init?: RequestInit & { tenantId?: string }
): Promise<Response> {
  const { tenantId, ...rest } = init ?? {};
  const headers = {
    ...firebaseBlackHeaders(firebaseIdToken, tenantId),
    ...(rest.headers as Record<string, string> | undefined),
  };
  return fetch(blackEndpoint(path), { ...rest, headers });
}
