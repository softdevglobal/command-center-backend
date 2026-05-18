/**
 * Google Identity Toolkit `accounts:signInWithPassword` (Firebase Auth REST).
 * Same endpoint for every Firebase project; only the Web API key differs.
 */

const SIGN_IN_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

/** Parsed `identitytoolkit#VerifyPasswordResponse` body (subset). */
export type IdentityToolkitPasswordResponse = {
  kind?: string;
  localId?: string;
  email?: string;
  displayName?: string;
  idToken?: string;
  registered?: boolean;
  refreshToken?: string;
  expiresIn?: string;
};

export async function signInWithPasswordIdentityToolkit(input: {
  email: string;
  password: string;
  webApiKey: string;
}): Promise<
  | { ok: true; data: IdentityToolkitPasswordResponse }
  | { ok: false; message: string; status?: number }
> {
  const key = input.webApiKey.trim();
  if (!key) {
    return { ok: false, message: "Missing Firebase Web API key." };
  }

  const url = `${SIGN_IN_URL}?key=${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email.trim(),
        password: input.password,
        returnSecureToken: true,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    return { ok: false, message: `Identity Toolkit request failed: ${msg}` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      message: "Identity Toolkit: invalid JSON response",
      status: res.status,
    };
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    const message =
      err?.error?.message ?? `Identity Toolkit HTTP ${res.status}`;
    return { ok: false, message, status: res.status };
  }

  return { ok: true, data: json as IdentityToolkitPasswordResponse };
}
