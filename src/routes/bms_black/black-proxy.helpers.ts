import type { Request, Response } from "express";

import type { SupabaseAuthLocals } from "../../middleware/supabase-auth.middleware.js";
import { getFirebaseIdTokenForSupabaseUser } from "../../services/auth/firebase-black-login.store.js";

const NO_FIREBASE_TOKEN_ERROR =
  "No stored Firebase Black idToken for this user. Sign in again with POST /api/auth/login while FIREBASE_BLACK_WEB_API_KEY is set and Firebase accepts the same password.";

export function singleHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

export function singleQuery(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return "";
}

export async function forwardUpstream(
  res: Response,
  upstream: globalThis.Response
): Promise<void> {
  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") ?? "";
  res.status(upstream.status);
  if (ct.includes("application/json") && text.trim() !== "") {
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

export type FirebaseBlackProxyContext = {
  firebaseIdToken: string;
};

export type BlackTenantProxyContext = FirebaseBlackProxyContext & {
  tenantId: string;
};

export function resolveFirebaseBlackProxyContext(
  res: Response
): FirebaseBlackProxyContext | null {
  const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;
  const supabaseUserId = auth?.user?.id;
  if (!supabaseUserId) {
    res.status(401).json({ error: "Missing Supabase session." });
    return null;
  }

  const firebaseIdToken = getFirebaseIdTokenForSupabaseUser(supabaseUserId);
  if (!firebaseIdToken) {
    res.status(403).json({ error: NO_FIREBASE_TOKEN_ERROR });
    return null;
  }

  return { firebaseIdToken };
}

/** Optional owner scope — forwards `X-Tenant-Id` to Black only when the client sends it. */
export function optionalTenantId(req: Request): string | undefined {
  const tid = singleHeader(req.headers["x-tenant-id"]);
  return tid || undefined;
}

export function resolveBlackTenantProxyContext(
  req: Request,
  res: Response
): BlackTenantProxyContext | null {
  const base = resolveFirebaseBlackProxyContext(res);
  if (!base) return null;

  const tenantId = singleHeader(req.headers["x-tenant-id"]);
  if (!tenantId) {
    res.status(400).json({
      error:
        "Missing X-Tenant-Id header (owner uid for BMS Black call-center scope).",
    });
    return null;
  }

  return { ...base, tenantId };
}

export async function runBlackProxy(
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
  await forwardUpstream(res, upstream);
}
