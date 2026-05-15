import type { Request, Response } from "express";
import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import type { SupabaseAuthLocals } from "../../middleware/supabase-auth.middleware.js";
import { getFirebaseIdTokenForSupabaseUser } from "../../services/auth/firebase-black-login.store.js";
import {
  proxyBlackCallCenterServiceById,
  proxyBlackCallCenterServices,
  proxyBlackCallCenterServicesByBranch,
} from "../../services/bms_black/black-call-center-services.proxy.service.js";

const router = Router();

function singleHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function singleQuery(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return "";
}

async function forwardUpstream(
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

type BlackProxyContext = {
  firebaseIdToken: string;
  tenantId: string;
};

function resolveBlackProxyContext(
  req: Request,
  res: Response
): BlackProxyContext | null {
  const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;
  const supabaseUserId = auth?.user?.id;
  if (!supabaseUserId) {
    res.status(401).json({ error: "Missing Supabase session." });
    return null;
  }

  const tenantId = singleHeader(req.headers["x-tenant-id"]);
  if (!tenantId) {
    res.status(400).json({
      error:
        "Missing X-Tenant-Id header (owner uid for BMS Black call-center services scope).",
    });
    return null;
  }

  const firebaseIdToken = getFirebaseIdTokenForSupabaseUser(supabaseUserId);
  if (!firebaseIdToken) {
    res.status(403).json({
      error:
        "No stored Firebase Black idToken for this user. Sign in again with POST /api/auth/login while FIREBASE_BLACK_WEB_API_KEY is set and Firebase accepts the same password.",
    });
    return null;
  }

  return { firebaseIdToken, tenantId };
}

/**
 * GET /api/bms-black/services
 *
 * **Frontend:** `Authorization: Bearer <Supabase access_token>`, `X-Tenant-Id: <owner uid>`.
 * **Upstream Black:** `GET /api/call-center/services` with stored Firebase idToken.
 */
router.get("/services", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackProxyContext(req, res);
  if (!ctx) return;

  let upstream: globalThis.Response;
  try {
    upstream = await proxyBlackCallCenterServices(
      ctx.firebaseIdToken,
      ctx.tenantId
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upstream request failed";
    res.status(502).json({ success: false, error: msg });
    return;
  }

  await forwardUpstream(res, upstream);
});

/**
 * GET /api/bms-black/services-by-branch?branchId=...
 *
 * **Frontend:** same auth as `/services`, plus required query `branchId`.
 * **Upstream Black:** `GET /api/call-center/services?branchId=...`.
 */
router.get("/services-by-branch", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackProxyContext(req, res);
  if (!ctx) return;

  const branchId = singleQuery(req.query.branchId);
  if (!branchId) {
    res.status(400).json({
      error: "Missing required query parameter branchId.",
    });
    return;
  }

  let upstream: globalThis.Response;
  try {
    upstream = await proxyBlackCallCenterServicesByBranch(
      ctx.firebaseIdToken,
      ctx.tenantId,
      branchId
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upstream request failed";
    res.status(502).json({ success: false, error: msg });
    return;
  }

  await forwardUpstream(res, upstream);
});

/**
 * GET /api/bms-black/services/:id
 *
 * **Frontend:** same auth as `/services` (`Authorization` + `X-Tenant-Id`).
 * **Upstream Black:** `GET /api/call-center/services/:id`.
 */
router.get("/services/:id", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackProxyContext(req, res);
  if (!ctx) return;

  const serviceId = String(req.params.id ?? "").trim();
  if (!serviceId) {
    res.status(400).json({ error: "Missing service id." });
    return;
  }

  let upstream: globalThis.Response;
  try {
    upstream = await proxyBlackCallCenterServiceById(
      ctx.firebaseIdToken,
      ctx.tenantId,
      serviceId
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upstream request failed";
    res.status(502).json({ success: false, error: msg });
    return;
  }

  await forwardUpstream(res, upstream);
});

export default router;
