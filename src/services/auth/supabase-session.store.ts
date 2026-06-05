/**
 * Server-side Supabase refresh tokens keyed by Supabase `user.id`.
 * Mirrors Firebase Black/Pink stores: ~1h access_token JWT, auto-refreshed on each
 * API call for up to `AUTH_SESSION_HOURS` (default 4) after login.
 */

import { createSupabaseClient } from "../../db/supabase/supabase.client.js";
import {
  getSupabaseAnonKeyForEdge,
  getSupabaseProjectUrl,
} from "../../db/supabase/supabase.client.js";
import { decodeJwtPayloadUnsafe } from "../../utils/jwt-payload.util.js";
import {
  authStoredSessionValidUntil,
  getAuthSessionHours,
} from "./firebase-stored-session.config.js";

export type SupabaseSessionForUser = {
  refreshToken: string;
  /** Epoch ms when the cached access_token JWT expires. */
  accessTokenExpiresAt?: number | undefined;
  /** Epoch ms — stop auto-refresh after this (default 4h from login). */
  sessionValidUntil: number;
  storedAt: string;
};

const bySupabaseUserId = new Map<string, SupabaseSessionForUser>();

const REFRESH_SKEW_MS = 5 * 60 * 1000;

const inflightRefresh = new Map<
  string,
  Promise<{ accessToken: string; expiresAt?: number } | null>
>();

function accessTokenExpiresAtFromSession(
  expiresAt: number | undefined,
  expiresIn: number | undefined
): number | undefined {
  if (expiresAt !== undefined && Number.isFinite(expiresAt)) {
    return expiresAt * 1000;
  }
  if (expiresIn !== undefined && Number.isFinite(expiresIn) && expiresIn > 0) {
    return Date.now() + expiresIn * 1000;
  }
  return undefined;
}

export function rememberSupabaseSessionForUser(entry: {
  supabaseUserId: string;
  refreshToken: string;
  expiresAt?: number | undefined;
  expiresIn?: number | undefined;
  /** Preserve on refresh; omit on login to start a new window. */
  sessionValidUntil?: number | undefined;
}): void {
  const supabaseUserId = entry.supabaseUserId.trim();
  const refreshToken = entry.refreshToken.trim();
  if (!supabaseUserId || !refreshToken) return;

  const row: SupabaseSessionForUser = {
    refreshToken,
    storedAt: new Date().toISOString(),
    sessionValidUntil:
      entry.sessionValidUntil ?? authStoredSessionValidUntil(),
  };
  const exp = accessTokenExpiresAtFromSession(entry.expiresAt, entry.expiresIn);
  if (exp !== undefined) row.accessTokenExpiresAt = exp;
  bySupabaseUserId.set(supabaseUserId, row);
}

function rowSessionExpired(row: SupabaseSessionForUser): boolean {
  return row.sessionValidUntil <= Date.now();
}

function rowIsExpiring(row: SupabaseSessionForUser): boolean {
  if (row.accessTokenExpiresAt === undefined) return false;
  return row.accessTokenExpiresAt - REFRESH_SKEW_MS <= Date.now();
}

function accessTokenIsExpiring(expSec: number | undefined): boolean {
  if (expSec === undefined || !Number.isFinite(expSec)) return false;
  return expSec * 1000 - REFRESH_SKEW_MS <= Date.now();
}

async function refreshRow(
  key: string,
  row: SupabaseSessionForUser
): Promise<{ accessToken: string; expiresAt?: number } | null> {
  const url = getSupabaseProjectUrl();
  const anon = getSupabaseAnonKeyForEdge();
  if (!url || !anon) return null;

  const supabase = createSupabaseClient(url, anon);
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: row.refreshToken,
  });

  if (error || !data.session?.access_token) {
    console.warn(
      `[supabase-session.store] Refresh failed for ${key}: ${error?.message ?? "no session"}`
    );
    if (
      error?.status === 400 ||
      error?.status === 401 ||
      error?.status === 403
    ) {
      bySupabaseUserId.delete(key);
    }
    return null;
  }

  const session = data.session;
  const next: SupabaseSessionForUser = {
    refreshToken: session.refresh_token?.trim() || row.refreshToken,
    storedAt: new Date().toISOString(),
    sessionValidUntil: row.sessionValidUntil,
  };
  const exp = accessTokenExpiresAtFromSession(
    session.expires_at,
    session.expires_in
  );
  if (exp !== undefined) next.accessTokenExpiresAt = exp;
  bySupabaseUserId.set(key, next);

  const out: { accessToken: string; expiresAt?: number } = {
    accessToken: session.access_token,
  };
  if (session.expires_at !== undefined) out.expiresAt = session.expires_at;
  return out;
}

async function refreshForUser(
  supabaseUserId: string
): Promise<{ accessToken: string; expiresAt?: number } | null> {
  const key = supabaseUserId.trim();
  if (!key) return null;
  const row = bySupabaseUserId.get(key);
  if (!row || rowSessionExpired(row)) {
    if (row) bySupabaseUserId.delete(key);
    return null;
  }

  let pending = inflightRefresh.get(key);
  if (!pending) {
    pending = refreshRow(key, row).finally(() => {
      inflightRefresh.delete(key);
    });
    inflightRefresh.set(key, pending);
  }
  return pending;
}

export type ResolveSupabaseAccessTokenResult =
  | {
      ok: true;
      accessToken: string;
      /** Set when a new access_token was minted (client should update Bearer). */
      refreshed?: boolean;
      expiresAt?: number;
    }
  | { ok: false; reason: "invalid" | "expired" | "no_session" };

/**
 * Resolve a Supabase access_token for middleware: validates the JWT when still valid,
 * otherwise refreshes using the stored refresh_token if within the 4-hour session window.
 */
export async function resolveSupabaseAccessToken(
  bearerToken: string
): Promise<ResolveSupabaseAccessTokenResult> {
  const token = bearerToken.trim();
  if (!token) return { ok: false, reason: "invalid" };

  const payload = decodeJwtPayloadUnsafe(token);
  if (!payload) return { ok: false, reason: "invalid" };
  const sub = payload.sub?.trim();
  if (!sub) return { ok: false, reason: "invalid" };

  const row = bySupabaseUserId.get(sub);
  if (!row) {
    if (payload.exp !== undefined && payload.exp * 1000 <= Date.now()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, accessToken: token };
  }

  if (rowSessionExpired(row)) {
    bySupabaseUserId.delete(sub);
    console.warn(
      `[supabase-session.store] Session expired after ${getAuthSessionHours()}h for ${sub} — login again.`
    );
    return { ok: false, reason: "expired" };
  }

  const jwtExpired =
    payload.exp !== undefined && payload.exp * 1000 <= Date.now();
  const shouldRefresh =
    jwtExpired || rowIsExpiring(row) || accessTokenIsExpiring(payload.exp);

  if (!shouldRefresh) {
    return { ok: true, accessToken: token };
  }

  const refreshed = await refreshForUser(sub);
  if (!refreshed) {
    if (!jwtExpired) return { ok: true, accessToken: token };
    return { ok: false, reason: "expired" };
  }

  const latestRow = bySupabaseUserId.get(sub);
  const out: Extract<ResolveSupabaseAccessTokenResult, { ok: true }> = {
    ok: true,
    accessToken: refreshed.accessToken,
    refreshed: true,
  };
  if (latestRow) {
    out.expiresAt = Math.floor(latestRow.sessionValidUntil / 1000);
  }
  return out;
}

/** Explicit refresh via POST /api/auth/refresh (refresh_token from login JSON). */
export async function refreshSupabaseSessionWithRefreshToken(
  refreshToken: string
): Promise<
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      expiresAt?: number;
      tokenType: string;
      userId: string;
      sessionValidUntil: number;
    }
  | { ok: false; message: string }
> {
  const rt = refreshToken.trim();
  if (!rt) return { ok: false, message: "refresh_token is required." };

  const url = getSupabaseProjectUrl();
  const anon = getSupabaseAnonKeyForEdge();
  if (!url || !anon) {
    return {
      ok: false,
      message:
        "Missing SUPABASE_URL and SUPABASE_ANON_KEY for session refresh.",
    };
  }

  const supabase = createSupabaseClient(url, anon);
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: rt,
  });

  if (error || !data.session || !data.user) {
    return {
      ok: false,
      message: error?.message ?? "Session refresh failed.",
    };
  }

  const session = data.session;
  const existing = bySupabaseUserId.get(data.user.id);
  rememberSupabaseSessionForUser({
    supabaseUserId: data.user.id,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    expiresIn: session.expires_in,
    sessionValidUntil: existing?.sessionValidUntil,
  });

  const sessionValidUntilSec = Math.floor(
    (existing?.sessionValidUntil ?? authStoredSessionValidUntil()) / 1000
  );

  const out: {
    ok: true;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    expiresAt?: number;
    tokenType: string;
    userId: string;
    sessionValidUntil: number;
  } = {
    ok: true,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    tokenType: session.token_type,
    userId: data.user.id,
    sessionValidUntil: sessionValidUntilSec,
  };
  if (session.expires_at !== undefined) out.expiresAt = session.expires_at;
  return out;
}
