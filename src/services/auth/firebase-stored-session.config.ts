/** Default: auth session (Supabase + Firebase Black/Pink) stays valid for 4 hours after login. */
const DEFAULT_SESSION_HOURS = 4;

function sessionHoursFromEnv(): number {
  const raw =
    Number(process.env.AUTH_SESSION_HOURS ?? "") ||
    Number(process.env.FIREBASE_STORED_SESSION_HOURS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_HOURS;
}

/**
 * How long stored auth sessions stay valid after login (Supabase access_token refresh +
 * Firebase Black/Pink idToken auto-refresh).
 * Override with `AUTH_SESSION_HOURS` or `FIREBASE_STORED_SESSION_HOURS` in `.env` (e.g. `4`).
 */
export function getFirebaseStoredSessionMs(): number {
  return sessionHoursFromEnv() * 60 * 60 * 1000;
}

/** JWT `expires_in` seconds aligned with the configured session window. */
export function getAuthSessionExpiresInSeconds(): number {
  return sessionHoursFromEnv() * 60 * 60;
}

export function getFirebaseStoredSessionHours(): number {
  return getFirebaseStoredSessionMs() / (60 * 60 * 1000);
}

/** Alias for unified auth session config (Supabase + Firebase). */
export const getAuthSessionHours = getFirebaseStoredSessionHours;

/** Epoch ms — auth session ends at this time unless user logs in again. */
export function firebaseStoredSessionValidUntil(fromMs = Date.now()): number {
  return fromMs + getFirebaseStoredSessionMs();
}

export const authStoredSessionValidUntil = firebaseStoredSessionValidUntil;

/** `expires_in` / `expires_at` / `sessionValidUntil` for login and refresh JSON (default 4h). */
export function authSessionTokenExpiryForResponse(validUntilSec?: number): {
  expires_in: number;
  expires_at: number;
  sessionValidUntil: number;
  sessionValidHours: number;
} {
  const sessionValidUntil =
    validUntilSec ?? Math.floor(authStoredSessionValidUntil() / 1000);
  return {
    expires_in: getAuthSessionExpiresInSeconds(),
    expires_at: sessionValidUntil,
    sessionValidUntil,
    sessionValidHours: getAuthSessionHours(),
  };
}
