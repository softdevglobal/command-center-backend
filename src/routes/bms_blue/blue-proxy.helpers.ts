import type { Response } from "express";

import type { SupabaseAuthLocals } from "../../middleware/supabase-auth.middleware.js";
import { getFirebaseBlueIdTokenForSupabaseUser } from "../../services/auth/firebase-blue-login.store.js";

const NO_FIREBASE_TOKEN_ERROR =
  "No stored Firebase Blue idToken for this user. Sign in again with POST /api/auth/login while FIREBASE_BLUE_WEB_API_KEY is set and Firebase accepts the same password.";

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

export type FirebaseBlueProxyContext = {
  firebaseIdToken: string;
};

export async function resolveFirebaseBlueProxyContext(
  res: Response
): Promise<FirebaseBlueProxyContext | null> {
  const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;
  const supabaseUserId = auth?.user?.id;
  if (!supabaseUserId) {
    res.status(401).json({ error: "Missing Supabase session." });
    return null;
  }

  const firebaseIdToken =
    await getFirebaseBlueIdTokenForSupabaseUser(supabaseUserId);
  if (!firebaseIdToken) {
    res.status(403).json({ error: NO_FIREBASE_TOKEN_ERROR });
    return null;
  }

  return { firebaseIdToken };
}

export async function runBlueProxy(
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
