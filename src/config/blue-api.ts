/**
 * Base URL for BMS Pro Trade (Blue) REST API.
 * Override via `BLUE_API_BASE_URL` for staging/local development.
 */
export function getBlueApiBaseUrl(): string {
  const raw = (process.env.BLUE_API_BASE_URL ?? "").trim();
  const base = raw === "" ? "http://127.0.0.1:3000" : raw;
  return base.replace(/\/+$/, "");
}

export function blueEndpoint(path: string): string {
  const base = getBlueApiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
