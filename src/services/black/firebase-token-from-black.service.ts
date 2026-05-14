import { blackEndpoint } from "../../config/black-api.js";

export type BlackFirebaseToken = {
  firebaseCustomToken: string;
  uid: string;
  expiresIn: number;
};

/**
 * Calls BMS Black `POST /api/call-center/supabase/firebase-token` with the
 * agent's Supabase access_token and returns a Firebase custom token that the
 * client can use with `signInWithCustomToken(...)` against BMS Black Firebase.
 */
export async function fetchFirebaseBlackTokenForSupabaseUser(input: {
  supabaseBearer: string;
}): Promise<BlackFirebaseToken | null> {
  const { supabaseBearer } = input;
  if (!supabaseBearer) return null;

  const url = blackEndpoint("/api/call-center/supabase/firebase-token");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseBearer}`,
      },
    });
  } catch {
    // Black not reachable — login still succeeds, client can retry later.
    return null;
  }

  if (!res.ok) return null;

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    return null;
  }

  const ok = payload as {
    firebaseCustomToken?: string;
    uid?: string;
    expiresIn?: number;
  } | null;

  if (!ok?.firebaseCustomToken || !ok.uid) return null;

  return {
    firebaseCustomToken: ok.firebaseCustomToken,
    uid: ok.uid,
    expiresIn: typeof ok.expiresIn === "number" ? ok.expiresIn : 3600,
  };
}
