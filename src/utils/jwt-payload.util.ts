/** Decoded JWT payload (no signature verification — caller must not trust claims alone). */
export type JwtPayloadUnsafe = {
  sub?: string;
  exp?: number;
};

/** Base64url-decode the middle segment of a JWT without verifying the signature. */
export function decodeJwtPayloadUnsafe(token: string): JwtPayloadUnsafe | null {
  const parts = token.trim().split(".");
  if (parts.length < 2) return null;
  const segment = parts[1];
  if (!segment) return null;

  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const json = Buffer.from(padded + "=".repeat(padLen), "base64").toString(
      "utf8"
    );
    const parsed = JSON.parse(json) as JwtPayloadUnsafe;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
