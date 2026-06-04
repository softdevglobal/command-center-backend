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
 * This process keeps **one Firebase identity per Supabase user id** in an in-memory `Map`:
 *
 * ```
 *   supabaseUserId_A  →  { idToken, refreshToken, expiresAt, … }
 *   supabaseUserId_B  →  { idToken, refreshToken, expiresAt, … }
 * ```
 *
 * When user B calls `GET /api/bms-black/services` with **their** `access_token`:
 *
 * 1. `attachSupabaseUser` validates that JWT and resolves **Supabase `user.id`** (e.g. user B’s uuid).
 * 2. `getFirebaseIdTokenForSupabaseUser(user.id)` returns **only user B’s** stored Firebase token,
 *    transparently refreshing it via Identity Toolkit if the cached idToken is expiring.
 * 3. The proxy forwards `Authorization: Bearer <freshFirebaseTokenB>` to Black — not A’s or C’s.
 *
 * Re-login for the same Supabase user **overwrites** that row with a fresh Firebase identity.
 * Different Supabase users never share an entry (keys are `user.id`, not email).
 *
 * ## Token lifetime / refresh
 *
 * Identity Toolkit idTokens expire ~1 hour after issuance. The accompanying long-lived
 * `refreshToken` is stored here and exchanged via `firebase-identity-toolkit-refresh.service`
 * a few minutes before expiry, so a long-lived Supabase session keeps working without
 * re-prompting for a password.
 *
 * ## Limits
 *
 * - **Single Node process:** RAM only; server restart clears all entries → users must log in again.
 * - **Horizontal scale:** use Redis/DB keyed by `supabaseUserId` with TTL aligned to refresh
 *   token lifetime.
 * - **Security:** idTokens / refreshTokens are secrets; never log or return them from debug helpers.
 */

import { refreshIdTokenWithRefreshToken } from "./firebase-identity-toolkit-refresh.service.js";

/** One cached Firebase Black session for a single Supabase Auth user. */
export type FirebaseBlackIdentityForUser = {
  /** Firebase Identity Toolkit idToken (~1 hour lifetime). */
  idToken: string;
  /** Long-lived refresh token used to mint a new idToken before/after expiry. */
  refreshToken?: string | undefined;
  /** Epoch ms when the cached idToken expires (Identity Toolkit `expiresIn`). */
  expiresAt?: number | undefined;
  /** ISO timestamp when this row was last written (login or refresh). */
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
 * Refresh ahead of expiry by this much, so a request that arrives just before the wall-clock
 * cutoff still gets a token good for the upstream round-trip.
 */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * In-flight refresh dedup so concurrent requests for the same user don't all hit
 * the Secure Token endpoint in parallel — they await the same Promise.
 */
const inflightRefresh = new Map<
  string,
  Promise<FirebaseBlackIdentityForUser | null>
>();

function expiresAtFromExpiresIn(expiresIn: string | undefined): number | undefined {
  if (!expiresIn) return undefined;
  const seconds = Number.parseInt(expiresIn, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Date.now() + seconds * 1000;
}

/**
 * Save (or replace) the Firebase Black identity for one Supabase user after successful login.
 *
 * **When:** `loginWithSupabasePassword` in `supabase-auth.service.ts`, right after Supabase
 * sign-in succeeds and Identity Toolkit returns an `idToken` + `refreshToken` (when
 * `FIREBASE_BLACK_WEB_API_KEY` is set).
 *
 * **Why:** Later Black proxy routes only receive the Supabase `access_token`; this map is how
 * we recover the matching Firebase credential without the client sending two bearer tokens.
 */
export function rememberFirebaseBlackIdentityForUser(entry: {
  supabaseUserId: string;
  idToken: string;
  refreshToken?: string | undefined;
  expiresIn?: string | undefined;
  email?: string | undefined;
}): void {
  const { supabaseUserId, idToken, refreshToken, expiresIn, email } = entry;
  if (!supabaseUserId.trim() || !idToken.trim()) return;
  const row: FirebaseBlackIdentityForUser = {
    idToken: idToken.trim(),
    storedAt: new Date().toISOString(),
  };
  const trimmedRefresh = refreshToken?.trim();
  if (trimmedRefresh) row.refreshToken = trimmedRefresh;
  const exp = expiresAtFromExpiresIn(expiresIn);
  if (exp !== undefined) row.expiresAt = exp;
  if (email !== undefined) row.email = email;
  bySupabaseUserId.set(supabaseUserId.trim(), row);
}

function blackWebApiKey(): string {
  return (process.env.FIREBASE_BLACK_WEB_API_KEY ?? "").trim();
}

async function refreshRow(
  key: string,
  row: FirebaseBlackIdentityForUser
): Promise<FirebaseBlackIdentityForUser | null> {
  const apiKey = blackWebApiKey();
  if (!apiKey || !row.refreshToken) return null;

  const result = await refreshIdTokenWithRefreshToken({
    refreshToken: row.refreshToken,
    webApiKey: apiKey,
  });
  if (!result.ok) {
    console.warn(
      `[firebase-black-login.store] Refresh failed for ${key}: ${result.message}`
    );
    // Drop the row — refresh tokens become invalid on password change / disable / revoke.
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      bySupabaseUserId.delete(key);
    }
    return null;
  }

  const idToken = result.data.id_token?.trim();
  if (!idToken) return null;

  const next: FirebaseBlackIdentityForUser = {
    idToken,
    storedAt: new Date().toISOString(),
  };
  const newRefresh = result.data.refresh_token?.trim() ?? row.refreshToken;
  if (newRefresh) next.refreshToken = newRefresh;
  const exp = expiresAtFromExpiresIn(result.data.expires_in);
  if (exp !== undefined) next.expiresAt = exp;
  if (row.email !== undefined) next.email = row.email;
  bySupabaseUserId.set(key, next);
  return next;
}

function rowIsExpiring(row: FirebaseBlackIdentityForUser): boolean {
  if (row.expiresAt === undefined) return false;
  return row.expiresAt - REFRESH_SKEW_MS <= Date.now();
}

/**
 * Resolve the Firebase Black idToken to forward to BMS Black for the **current** request.
 *
 * Transparently refreshes via Secure Token API when the cached idToken is within
 * `REFRESH_SKEW_MS` of expiry. Concurrent callers for the same user dedupe onto a single
 * refresh round-trip.
 *
 * Returns `null` when there is no cached identity for this user (never logged in with the
 * Black Web API key set, or server restarted), or when a refresh attempt failed (e.g. the
 * password changed and the refresh token was revoked) — route responds **403** with
 * “sign in again” guidance.
 *
 * @param supabaseUserId - From `res.locals.supabaseAuth.user.id`.
 */
export async function getFirebaseIdTokenForSupabaseUser(
  supabaseUserId: string
): Promise<string | null> {
  const key = supabaseUserId.trim();
  if (!key) return null;
  const row = bySupabaseUserId.get(key);
  if (!row) return null;

  if (!rowIsExpiring(row)) return row.idToken;

  let pending = inflightRefresh.get(key);
  if (!pending) {
    pending = refreshRow(key, row).finally(() => {
      inflightRefresh.delete(key);
    });
    inflightRefresh.set(key, pending);
  }
  const refreshed = await pending;
  if (refreshed) return refreshed.idToken;

  // Refresh failed but row may still hold a not-yet-expired token (skew margin) —
  // re-read in case another caller refreshed concurrently.
  const latest = bySupabaseUserId.get(key);
  if (!latest) return null;
  if (latest.expiresAt !== undefined && latest.expiresAt <= Date.now()) {
    return null;
  }
  return latest.idToken;
}

/**
 * List Supabase user ids that currently have a stored Firebase session (no tokens exposed).
 *
 * **When:** Debugging / health checks only — not used in production request paths.
 */
export function listSupabaseUserIdsWithFirebaseIdentity(): readonly string[] {
  return [...bySupabaseUserId.keys()];
}
