/**
 * Base URL for BMS Pro Pink REST API (Next.js admin panel).
 * Override via `PINK_API_BASE_URL` for staging/local development.
 */
export function getPinkApiBaseUrl(): string {
  const raw = (process.env.PINK_API_BASE_URL ?? "").trim();
  const base = raw === "" ? "https://pink.bmspros.com.au" : raw;
  return base.replace(/\/+$/, "");
}

export function pinkEndpoint(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getPinkApiBaseUrl()}${p}`;
}
