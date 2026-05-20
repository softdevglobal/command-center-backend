/**
 * Server-side bridge between **Supabase sessions** and **Firebase Pink idTokens**
 * (bmspro-pink), mirroring `firebase-black-login.store.ts`.
 *
 * At login we call Identity Toolkit with `FIREBASE_PINK_WEB_API_KEY` and cache the
 * returned idToken keyed by Supabase `user.id`. Future Pink proxy routes can resolve
 * the correct token via `getFirebasePinkIdTokenForSupabaseUser`.
 */

/** One cached Firebase Pink session for a single Supabase Auth user. */
export type FirebasePinkIdentityForUser = {
  /** Firebase Identity Toolkit idToken from `accounts:signInWithPassword` at login. */
  idToken: string;
  /** ISO timestamp when this row was last written (login or re-login). */
  storedAt: string;
  /** Optional email copy for troubleshooting (not used for lookup). */
  email?: string | undefined;
};

/** Supabase Auth `user.id` → latest Firebase Pink identity for that user. */
const bySupabaseUserId = new Map<string, FirebasePinkIdentityForUser>();

/**
 * Save (or replace) the Firebase Pink idToken for one Supabase user after successful login.
 */
export function rememberFirebasePinkIdentityForUser(entry: {
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

/**
 * Resolve the Firebase Pink idToken for the current Supabase user.
 * Returns `null` if not stored (never logged in with Pink key set, or server restarted).
 */
export function getFirebasePinkIdTokenForSupabaseUser(
  supabaseUserId: string
): string | null {
  const row = bySupabaseUserId.get(supabaseUserId.trim());
  return row?.idToken ?? null;
}

/** Supabase user ids with a stored Pink session (no tokens exposed). */
export function listSupabaseUserIdsWithFirebasePinkIdentity(): readonly string[] {
  return [...bySupabaseUserId.keys()];
}
