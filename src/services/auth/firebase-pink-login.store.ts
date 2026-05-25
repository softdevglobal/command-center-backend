/**
 * Server-side bridge between **Supabase sessions** and **Firebase Pink idTokens**
 * (bmspro-pink), mirroring `firebase-black-login.store.ts`.
 *
 * At login we call Identity Toolkit with `FIREBASE_PINK_WEB_API_KEY` and cache the
 * returned `idToken` + `refreshToken` keyed by Supabase `user.id`. Future Pink proxy
 * routes resolve the correct token via `getFirebasePinkIdTokenForSupabaseUser`,
 * which transparently refreshes near-expiry idTokens via the Secure Token API.
 */

import { refreshIdTokenWithRefreshToken } from "./firebase-identity-toolkit-refresh.service.js";

/** One cached Firebase Pink session for a single Supabase Auth user. */
export type FirebasePinkIdentityForUser = {
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

/** Supabase Auth `user.id` → latest Firebase Pink identity for that user. */
const bySupabaseUserId = new Map<string, FirebasePinkIdentityForUser>();

const REFRESH_SKEW_MS = 5 * 60 * 1000;

const inflightRefresh = new Map<
  string,
  Promise<FirebasePinkIdentityForUser | null>
>();

function expiresAtFromExpiresIn(expiresIn: string | undefined): number | undefined {
  if (!expiresIn) return undefined;
  const seconds = Number.parseInt(expiresIn, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Date.now() + seconds * 1000;
}

/**
 * Save (or replace) the Firebase Pink identity for one Supabase user after successful login.
 */
export function rememberFirebasePinkIdentityForUser(entry: {
  supabaseUserId: string;
  idToken: string;
  refreshToken?: string | undefined;
  expiresIn?: string | undefined;
  email?: string | undefined;
}): void {
  const { supabaseUserId, idToken, refreshToken, expiresIn, email } = entry;
  if (!supabaseUserId.trim() || !idToken.trim()) return;
  const row: FirebasePinkIdentityForUser = {
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

function pinkWebApiKey(): string {
  return (process.env.FIREBASE_PINK_WEB_API_KEY ?? "").trim();
}

async function refreshRow(
  key: string,
  row: FirebasePinkIdentityForUser
): Promise<FirebasePinkIdentityForUser | null> {
  const apiKey = pinkWebApiKey();
  if (!apiKey || !row.refreshToken) return null;

  const result = await refreshIdTokenWithRefreshToken({
    refreshToken: row.refreshToken,
    webApiKey: apiKey,
  });
  if (!result.ok) {
    console.warn(
      `[firebase-pink-login.store] Refresh failed for ${key}: ${result.message}`
    );
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      bySupabaseUserId.delete(key);
    }
    return null;
  }

  const idToken = result.data.id_token?.trim();
  if (!idToken) return null;

  const next: FirebasePinkIdentityForUser = {
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

function rowIsExpiring(row: FirebasePinkIdentityForUser): boolean {
  if (row.expiresAt === undefined) return false;
  return row.expiresAt - REFRESH_SKEW_MS <= Date.now();
}

/**
 * Resolve the Firebase Pink idToken for the current Supabase user, refreshing it
 * via the Secure Token API when within `REFRESH_SKEW_MS` of expiry.
 *
 * Returns `null` when not stored (never logged in with Pink key set, or server
 * restarted) or when a refresh attempt failed.
 */
export async function getFirebasePinkIdTokenForSupabaseUser(
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

  const latest = bySupabaseUserId.get(key);
  if (!latest) return null;
  if (latest.expiresAt !== undefined && latest.expiresAt <= Date.now()) {
    return null;
  }
  return latest.idToken;
}

/** Supabase user ids with a stored Pink session (no tokens exposed). */
export function listSupabaseUserIdsWithFirebasePinkIdentity(): readonly string[] {
  return [...bySupabaseUserId.keys()];
}
