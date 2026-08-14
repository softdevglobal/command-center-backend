/**
 * CORS allowlist. Set CORS_ORIGINS to a comma-separated list of origins.
 * Example: CORS_ORIGINS=https://commandcenter.bmspros.com.au,http://localhost:5173
 *
 * Do not set CORS_ORIGINS=* in production.
 */
export function getAllowedCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((o) => o !== "*");
  }

  return [
    "https://commandcenter.bmspros.com.au",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
  ];
}
