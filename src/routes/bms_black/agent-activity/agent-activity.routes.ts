import { Router } from "express";

import { attachSupabaseUser } from "../../../middleware/supabase-auth.middleware.js";
import { blackEndpoint } from "../../../config/black-api.js";
import {
  proxyBlackCallCenterAgentActivities,
  proxyBlackCallCenterAgentActivitiesMultipart,
} from "../../../services/bms_black/black-call-center-agent-activities.proxy.service.js";
import {
  optionalTenantId,
  resolveFirebaseBlackProxyContext,
  runBlackProxy,
} from "../black-proxy.helpers.js";

const router = Router();

function singleHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function isMultipartRequest(req: import("express").Request): boolean {
  return singleHeader(req.headers["content-type"])
    .toLowerCase()
    .startsWith("multipart/form-data");
}

/**
 * Step 3 — Record agent activity.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://127.0.0.1:5050/api/bms-black/agent-activities
 * ──────────────────────────────────────────────────────────────────────────────
 * **Frontend auth:** `Authorization: Bearer <Supabase access_token>` from POST /api/auth/login
 * **Upstream Black:** stored Firebase Black idToken from login (Step 1 Identity Toolkit)
 *
 * Upstream URLs (proxied by Command Center):
 *   POST {BLACK_API_BASE_URL}/api/call-center/agent-activities
 *   POST http://localhost:3000/api/call-center/agent-activities   (local — set BLACK_API_BASE_URL in .env)
 *   POST https://black.bmspros.com.au/api/call-center/agent-activities   (production)
 *
 * Optional header: `X-Tenant-Id` (owner uid) — forwarded to Black when provided.
 * Body:            JSON activity payload, or multipart/form-data when sending a
 *                  call recording file. Multipart bodies are streamed to Black.
 *
 * Prerequisites:
 *   1. POST /api/auth/login — Supabase + Firebase Black sign-in (4h session)
 *   2. Use returned `access_token` as Bearer on this route
 */
router.post("/agent-activities", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const headerTenant = optionalTenantId(req);

  const upstreamUrl = blackEndpoint("/api/call-center/agent-activities");

  await runBlackProxy(
    res,
    () => {
      if (isMultipartRequest(req)) {
        return proxyBlackCallCenterAgentActivitiesMultipart(
          ctx.firebaseIdToken,
          req,
          singleHeader(req.headers["content-type"]),
          singleHeader(req.headers["content-length"]) || undefined,
          headerTenant
        );
      }

      return proxyBlackCallCenterAgentActivities(
        ctx.firebaseIdToken,
        req.body,
        headerTenant
      );
    },
    { upstreamUrl }
  );
});

export default router;
