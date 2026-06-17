/**
 * Server-side bridge between **Supabase sessions** and **Firebase Blue idTokens**
 * (bmspro-trade), mirroring `firebase-black-login.store.ts` and `firebase-pink-login.store.ts`.
 *
 * At login we call Identity Toolkit with `FIREBASE_BLUE_WEB_API_KEY` and cache the
 * returned `idToken` + `refreshToken` keyed by Supabase `user.id`. Future Blue proxy
 * routes resolve the correct token via `getFirebaseBlueIdTokenForSupabaseUser`,
 * which transparently refreshes near-expiry idTokens via the Secure Token API.
 */

import { refreshIdTokenWithRefreshToken } from "./firebase-identity-toolkit-refresh.service.js";
import {
  firebaseStoredSessionValidUntil,
  getFirebaseStoredSessionHours,
} from "./firebase-stored-session.config.js";

/** One cached Firebase Blue session for a single Supabase Auth user. */
export type FirebaseBlueIdentityForUser = {
  /** Firebase Identity Toolkit idToken (~1 hour lifetime). */
  idToken: string;
  /** Long-lived refresh token used to mint a new idToken before/after expiry. */
  refreshToken?: string | undefined;
  /** Epoch ms when the cached idToken expires (Identity Toolkit `expiresIn`). */
  expiresAt?: number | undefined;
  /** Epoch ms — stop auto-refresh and drop row after this (default 4h from login). */
  sessionValidUntil: number;
  /** ISO timestamp when this row was last written (login or refresh). */
  storedAt: string;
  /** Optional email copy for troubleshooting (not used for lookup). */
  email?: string | undefined;
};

/** Supabase Auth `user.id` → latest Firebase Blue identity for that user. */
const bySupabaseUserId = new Map<string, FirebaseBlueIdentityForUser>();

const REFRESH_SKEW_MS = 5 * 60 * 1000;

const inflightRefresh = new Map<
  string,
  Promise<FirebaseBlueIdentityForUser | null>
>();

function expiresAtFromExpiresIn(expiresIn: string | undefined): number | undefined {
  if (!expiresIn) return undefined;
  const seconds = Number.parseInt(expiresIn, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Date.now() + seconds * 1000;
}

/**
 * Save (or replace) the Firebase Blue identity for one Supabase user after successful login.
 */
export function rememberFirebaseBlueIdentityForUser(entry: {
  supabaseUserId: string;
  idToken: string;
  refreshToken?: string | undefined;
  expiresIn?: string | undefined;
  email?: string | undefined;
}): void {
  const { supabaseUserId, idToken, refreshToken, expiresIn, email } = entry;
  if (!supabaseUserId.trim() || !idToken.trim()) return;
  const row: FirebaseBlueIdentityForUser = {
    idToken: idToken.trim(),
    storedAt: new Date().toISOString(),
    sessionValidUntil: firebaseStoredSessionValidUntil(),
  };
  const trimmedRefresh = refreshToken?.trim();
  if (trimmedRefresh) row.refreshToken = trimmedRefresh;
  const exp = expiresAtFromExpiresIn(expiresIn);
  if (exp !== undefined) row.expiresAt = exp;
  if (email !== undefined) row.email = email;
  bySupabaseUserId.set(supabaseUserId.trim(), row);
}

function blueWebApiKey(): string {
  return (process.env.FIREBASE_BLUE_WEB_API_KEY ?? "").trim();
}

async function refreshRow(
  key: string,
  row: FirebaseBlueIdentityForUser
): Promise<FirebaseBlueIdentityForUser | null> {
  const apiKey = blueWebApiKey();
  if (!apiKey || !row.refreshToken) return null;

  const result = await refreshIdTokenWithRefreshToken({
    refreshToken: row.refreshToken,
    webApiKey: apiKey,
  });
  if (!result.ok) {
    console.warn(
      `[firebase-blue-login.store] Refresh failed for ${key}: ${result.message}`
    );
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      bySupabaseUserId.delete(key);
    }
    return null;
  }

  const idToken = result.data.id_token?.trim();
  if (!idToken) return null;

  const next: FirebaseBlueIdentityForUser = {
    idToken,
    storedAt: new Date().toISOString(),
    sessionValidUntil: row.sessionValidUntil,
  };
  const newRefresh = result.data.refresh_token?.trim() ?? row.refreshToken;
  if (newRefresh) next.refreshToken = newRefresh;
  const exp = expiresAtFromExpiresIn(result.data.expires_in);
  if (exp !== undefined) next.expiresAt = exp;
  if (row.email !== undefined) next.email = row.email;
  bySupabaseUserId.set(key, next);
  return next;
}

function rowIsExpiring(row: FirebaseBlueIdentityForUser): boolean {
  if (row.expiresAt === undefined) return false;
  return row.expiresAt - REFRESH_SKEW_MS <= Date.now();
}

function rowSessionExpired(row: FirebaseBlueIdentityForUser): boolean {
  return row.sessionValidUntil <= Date.now();
}

/**
 * Resolve the Firebase Blue idToken for the current Supabase user, refreshing it
 * via the Secure Token API when within `REFRESH_SKEW_MS` of expiry (for up to
 * **4 hours** after login — `FIREBASE_STORED_SESSION_HOURS`).
 *
 * Returns `null` when not stored, when the 4-hour window elapsed, or when refresh failed.
 */
export async function getFirebaseBlueIdTokenForSupabaseUser(
  supabaseUserId: string
): Promise<string | null> {
  const key = supabaseUserId.trim();
  if (!key) return null;
  const row = bySupabaseUserId.get(key);
  if (!row) return null;

  if (rowSessionExpired(row)) {
    bySupabaseUserId.delete(key);
    console.warn(
      `[firebase-blue-login.store] Session expired after ${getFirebaseStoredSessionHours()}h for ${key} — login again.`
    );
    return null;
  }

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

/** Supabase user ids with a stored Blue session (no tokens exposed). */
export function listSupabaseUserIdsWithFirebaseBlueIdentity(): readonly string[] {
  return [...bySupabaseUserId.keys()];
}
