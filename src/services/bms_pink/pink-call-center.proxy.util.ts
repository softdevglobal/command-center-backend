import { pinkEndpoint } from "../../config/pink-api.js";
import { normalizeFirebaseBearer } from "../bms_black/black-call-center.proxy.util.js";

export type PinkFetchInit = RequestInit & { tenantId?: string };

export function firebasePinkHeaders(
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

export function pinkCallCenterFetch(
  path: string,
  firebaseIdToken: string,
  init?: PinkFetchInit
): Promise<Response> {
  const { tenantId, ...rest } = init ?? {};
  const headers = {
    ...firebasePinkHeaders(firebaseIdToken, tenantId),
    ...(rest.headers as Record<string, string> | undefined),
  };
  return fetch(pinkEndpoint(path), { ...rest, headers });
}

export function pinkJsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  };
}

/** Append non-empty query params to `path`. */
export function withQuery(
  path: string,
  params: Record<string, string | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value?.trim()) search.set(key, value.trim());
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
