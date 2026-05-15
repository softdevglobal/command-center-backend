/**
 * In-memory map: Supabase `user.id` → last Firebase Identity Toolkit **idToken**
 * captured during `POST /api/auth/login` (same server process).
 *
 * **Security:** Tokens in RAM are sensitive; multi-instance deployments need Redis or similar.
 * Restarting the server clears this map.
 */
export type FirebaseBlackIdentityForUser = {
  idToken: string;
  storedAt: string;
  email?: string | undefined;
};

const bySupabaseUserId = new Map<string, FirebaseBlackIdentityForUser>();

/** Called after successful Identity Toolkit sign-in during login. */
export function rememberFirebaseBlackIdentityForUser(entry: {
  supabaseUserId: string;
  idToken: string;
  email?: string | undefined;
}): void {
  const { supabaseUserId, idToken, email } = entry;
  if (!supabaseUserId.trim() || !idToken.trim()) return;
  bySupabaseUserId.set(supabaseUserId.trim(), {
    idToken: idToken.trim(),
    storedAt: new Date().toISOString(),
    email,
  });
}

/** Firebase idToken to use when proxying to BMS Black for this Supabase user. */
export function getFirebaseIdTokenForSupabaseUser(
  supabaseUserId: string
): string | null {
  const row = bySupabaseUserId.get(supabaseUserId.trim());
  return row?.idToken ?? null;
}

/** Debug: Supabase user ids that have a stored Firebase session (no tokens in output). */
export function listSupabaseUserIdsWithFirebaseIdentity(): readonly string[] {
  return [...bySupabaseUserId.keys()];
}
