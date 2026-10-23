/**
 * Base URL for BMS Pro Black REST API (Next.js admin panel).
 * Override via `BLACK_API_BASE_URL` for staging/local development.
 */
export function getBlackApiBaseUrl(): string {
  const raw = (process.env.BLACK_API_BASE_URL ?? "").trim();
  const base = raw === "" ? "https://black.bmspros.com.au" : raw;
  return base.replace(/\/+$/, "");
}

/** Public Black site used in owner-facing login and password setup links. */
export function getBlackAdminBaseUrl(): string {
  const raw = (process.env.BLACK_ADMIN_BASE_URL ?? "").trim();
  return (raw || "https://black.bmspros.com.au").replace(/\/+$/, "");
}

export function blackEndpoint(path: string): string {
  const base = getBlackApiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function blackAdminEndpoint(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getBlackAdminBaseUrl()}${p}`;
}
