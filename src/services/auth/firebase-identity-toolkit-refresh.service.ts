/**
 * Google Secure Token API `grant_type=refresh_token` (Firebase Auth REST).
 *
 * Firebase Identity Toolkit idTokens expire ~1 hour after issuance. The
 * `refreshToken` returned alongside is long-lived and may be exchanged for a
 * new idToken via this endpoint without re-prompting the user for a password.
 *
 * Same endpoint for every Firebase project — only the Web API key differs.
 *
 * @see https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
 */

const REFRESH_URL = "https://securetoken.googleapis.com/v1/token";

/** Parsed Secure Token API response (subset). Note: snake_case field names. */
export type IdentityToolkitRefreshResponse = {
  access_token?: string;
  expires_in?: string;
  token_type?: string;
  refresh_token?: string;
  id_token?: string;
  user_id?: string;
  project_id?: string;
};

export async function refreshIdTokenWithRefreshToken(input: {
  refreshToken: string;
  webApiKey: string;
}): Promise<
  | { ok: true; data: IdentityToolkitRefreshResponse }
  | { ok: false; message: string; status?: number }
> {
  const key = input.webApiKey.trim();
  const refreshToken = input.refreshToken.trim();
  if (!key) return { ok: false, message: "Missing Firebase Web API key." };
  if (!refreshToken) return { ok: false, message: "Missing refresh token." };

  const url = `${REFRESH_URL}?key=${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    return { ok: false, message: `Secure Token request failed: ${msg}` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      message: "Secure Token: invalid JSON response",
      status: res.status,
    };
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    const message = err?.error?.message ?? `Secure Token HTTP ${res.status}`;
    return { ok: false, message, status: res.status };
  }

  return { ok: true, data: json as IdentityToolkitRefreshResponse };
}
