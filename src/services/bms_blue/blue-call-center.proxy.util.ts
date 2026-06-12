import { blueEndpoint } from "../../config/blue-api.js";

export function normalizeFirebaseBearer(firebaseIdToken: string): string {
  return firebaseIdToken.replace(/^Bearer\s+/i, "").trim();
}

export function firebaseBlueHeaders(
  firebaseIdToken: string
): Record<string, string> {
  return {
    Authorization: `Bearer ${normalizeFirebaseBearer(firebaseIdToken)}`,
    Accept: "application/json",
  };
}

export function blueCallCenterFetch(
  path: string,
  firebaseIdToken: string,
  init?: RequestInit
): Promise<Response> {
  const headers = {
    ...firebaseBlueHeaders(firebaseIdToken),
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(blueEndpoint(path), { ...init, headers });
}
