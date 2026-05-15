/**
 * Server-side bridge between **Supabase sessions** (what the frontend sends) and
 * **Firebase Black idTokens** (what BMS Black `/api/call-center/*` expects).
 *
 * ## Why this module exists
 *
 * - The Command Center UI authenticates with **Supabase** (`POST /api/auth/login`
 *   → `access_token` in `Authorization: Bearer …`).
 * - BMS Black call-center APIs authenticate with **Firebase** (`Authorization: Bearer <Firebase idToken>`).
 * - We do not ask the client to send the Firebase token on every Black proxy call; instead we
 *   remember it here at login and look it up when proxying (bookings, services, etc.).
 *
 * ## Many users logged in at once
 *
 * This process keeps **one Firebase idToken per Supabase user id** in an in-memory `Map`:
 *
 * ```
 *   supabaseUserId_A  →  { idToken: firebaseTokenA, storedAt, email? }
 *   supabaseUserId_B  →  { idToken: firebaseTokenB, storedAt, email? }
 *   supabaseUserId_C  →  { idToken: firebaseTokenC, storedAt, email? }
 * ```
 *
 * When user B calls `GET /api/bms-black/services` with **their** `access_token`:
 *
 * 1. `attachSupabaseUser` validates that JWT and resolves **Supabase `user.id`** (e.g. user B’s uuid).
 * 2. `getFirebaseIdTokenForSupabaseUser(user.id)` returns **only user B’s** stored Firebase token.
 * 3. The proxy forwards `Authorization: Bearer <firebaseTokenB>` to Black — not A’s or C’s.
 *
 * Re-login for the same Supabase user **overwrites** that row with a fresh Firebase idToken.
 * Different Supabase users never share an entry (keys are `user.id`, not email).
 *
 * ## Limits
 *
 * - **Single Node process:** RAM only; server restart clears all entries → users must log in again.
 * - **Horizontal scale:** use Redis/DB keyed by `supabaseUserId` with TTL aligned to Firebase token expiry.
 * - **Security:** idTokens are secrets; never log or return them from debug helpers.
 */

/** One cached Firebase Black session for a single Supabase Auth user. */
export type FirebaseBlackIdentityForUser = {
  /** Firebase Identity Toolkit idToken from `accounts:signInWithPassword` at login. */
  idToken: string;
  /** ISO timestamp when this row was last written (login or re-login). */
  storedAt: string;
  /** Optional email copy for troubleshooting (not used for lookup). */
  email?: string | undefined;
};

/**
 * Primary store: Supabase Auth `user.id` → latest Firebase Black identity for that user.
 * Lookup key is always Supabase user id, never the raw `access_token` string, because
 * middleware already turns `access_token` into `user.id` before we read from this map.
 */
const bySupabaseUserId = new Map<string, FirebaseBlackIdentityForUser>();

/**
 * Save (or replace) the Firebase Black idToken for one Supabase user after successful login.
 *
 * **When:** `loginWithSupabasePassword` in `supabase-auth.service.ts`, right after
 * Supabase sign-in succeeds and Identity Toolkit returns an `idToken` (when
 * `FIREBASE_BLACK_WEB_API_KEY` is set).
 *
 * **Why:** Later Black proxy routes only receive the Supabase `access_token`; this map is how
 * we recover the matching Firebase credential without the client sending two bearer tokens.
 *
 * **Multi-user:** Each call uses that login’s `data.user.id` as the key, so many agents can
 * be logged in concurrently — each gets their own map entry and their own Firebase token.
 */
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

/**
 * Resolve the Firebase Black idToken to forward to BMS Black for the **current** request.
 *
 * **When:** BMS Black proxy routes (`booking.routes`, `services.routes`, …) after
 * `attachSupabaseUser` has validated `Authorization: Bearer <access_token>` and set
 * `res.locals.supabaseAuth.user.id`.
 *
 * **Why:** Picks the correct Firebase token for whoever sent this request’s Supabase session.
 * Returns `null` if that user never completed a login that stored Firebase (or server restarted)
 * → route responds **403** with “sign in again” guidance.
 *
 * @param supabaseUserId - From `res.locals.supabaseAuth.user.id` (derived from incoming `access_token`).
 */
export function getFirebaseIdTokenForSupabaseUser(
  supabaseUserId: string
): string | null {
  const row = bySupabaseUserId.get(supabaseUserId.trim());
  return row?.idToken ?? null;
}

/**
 * List Supabase user ids that currently have a stored Firebase session (no tokens exposed).
 *
 * **When:** Debugging / health checks only — not used in production request paths.
 *
 * **Why:** Confirm how many distinct users have logged in since last restart without leaking idTokens.
 */
export function listSupabaseUserIdsWithFirebaseIdentity(): readonly string[] {
  return [...bySupabaseUserId.keys()];
}
