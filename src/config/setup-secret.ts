import type { Request } from "express";

/**
 * Bootstrap header auth. Disabled when ALLOW_SETUP_SECRET_AUTH is false/0/no,
 * or when SETUP_SECRET_KEY is unset.
 */
export function isSetupSecretAuthEnabled(): boolean {
  const flag = process.env.ALLOW_SETUP_SECRET_AUTH?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") {
    return false;
  }
  return Boolean(process.env.SETUP_SECRET_KEY?.trim());
}

/** True when the request presents a valid setup secret and bootstrap auth is enabled. */
export function matchesSetupSecret(req: Request): boolean {
  if (!isSetupSecretAuthEnabled()) {
    return false;
  }
  const expected = process.env.SETUP_SECRET_KEY?.trim();
  if (!expected) {
    return false;
  }
  const secret = req.headers["x-setup-secret"];
  return typeof secret === "string" && secret === expected;
}
