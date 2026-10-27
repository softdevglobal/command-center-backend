import type { Request, Response } from "express";

import type { SupabaseAuthLocals } from "../../middleware/supabase-auth.middleware.js";
import { getFirebasePinkIdTokenForSupabaseUser } from "../../services/auth/firebase-pink-login.store.js";
import { singleHeader } from "../bms_black/black-proxy.helpers.js";

export {
  optionalTenantId,
  singleQuery,
} from "../bms_black/black-proxy.helpers.js";

const NO_FIREBASE_TOKEN_ERROR =
  "No stored Firebase Pink idToken for this user. Sign in again with POST /api/auth/login while FIREBASE_PINK_WEB_API_KEY is set and Firebase Pink accepts the same password.";

/** Pass Pink's response through; non-JSON errors become a structured JSON error. */
export async function forwardPinkUpstream(
  res: Response,
  upstream: globalThis.Response
): Promise<void> {
  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") ?? "";
  const status = upstream.status;
  const isJson = ct.includes("application/json") && text.trim() !== "";

  if (status >= 400 && !isJson) {
    const isHtml =
      text.includes("<!DOCTYPE") || text.includes("<html") || ct.includes("text/html");
    res.status(status).json({
      ok: false,
      error: `Upstream BMS Pink returned ${status}${upstream.statusText ? ` ${upstream.statusText}` : ""}`,
      upstreamStatus: status,
      ...(status === 404
        ? {
            hint:
              "Route not found on BMS Pink. Deploy the /api/call-center routes there, or set PINK_API_BASE_URL=http://127.0.0.1:3000 when running Pink locally.",
          }
        : {}),
      upstreamBody: isHtml
        ? "(HTML error page from BMS Pink — endpoint likely missing on that host)"
        : text.trim().slice(0, 1000) || undefined,
    });
    return;
  }

  res.status(status);
  if (isJson) {
    try {
      res.json(JSON.parse(text) as unknown);
    } catch {
      res.type("text/plain").send(text);
    }
  } else if (!text.trim()) {
    res.end();
  } else {
    res.type(ct || "text/plain").send(text);
  }
}

export type FirebasePinkProxyContext = {
  firebaseIdToken: string;
};

export type PinkTenantProxyContext = FirebasePinkProxyContext & {
  tenantId: string;
};

export async function resolveFirebasePinkProxyContext(
  res: Response
): Promise<FirebasePinkProxyContext | null> {
  const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;
  const supabaseUserId = auth?.user?.id;
  if (!supabaseUserId) {
    res.status(401).json({ error: "Missing Supabase session." });
    return null;
  }

  // Refreshes the cached Firebase Pink idToken near expiry (see firebase-pink-login.store).
  const firebaseIdToken = await getFirebasePinkIdTokenForSupabaseUser(supabaseUserId);
  if (!firebaseIdToken) {
    res.status(403).json({ error: NO_FIREBASE_TOKEN_ERROR });
    return null;
  }

  return { firebaseIdToken };
}

/** Requires `X-Tenant-Id` (salon owner uid) — every salon-scoped Pink call-center route needs it. */
export async function resolvePinkTenantProxyContext(
  req: Request,
  res: Response
): Promise<PinkTenantProxyContext | null> {
  const base = await resolveFirebasePinkProxyContext(res);
  if (!base) return null;

  const tenantId = singleHeader(req.headers["x-tenant-id"]);
  if (!tenantId) {
    res.status(400).json({
      error: "Missing X-Tenant-Id header (salon owner uid for BMS Pink call-center scope).",
    });
    return null;
  }

  return { ...base, tenantId };
}

export async function runPinkProxy(
  res: Response,
  call: () => Promise<globalThis.Response>
): Promise<void> {
  let upstream: globalThis.Response;
  try {
    upstream = await call();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upstream request failed";
    res.status(502).json({ success: false, error: msg });
    return;
  }
  await forwardPinkUpstream(res, upstream);
}

/** Trimmed route param, or responds 400 and returns null. */
export function requiredParam(
  res: Response,
  raw: unknown,
  label: string
): string | null {
  const value = String(raw ?? "").trim();
  if (!value) {
    res.status(400).json({ error: `Missing ${label}.` });
    return null;
  }
  return value;
}

/** Collect the named query params that are present on the request. */
export function pickQuery(
  req: Request,
  keys: readonly string[]
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of keys) {
    const raw = req.query[key];
    const value =
      typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? "").trim() : "";
    if (value) out[key] = value;
  }
  return out;
}
