import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlackCallCenterBranchById,
  proxyBlackCallCenterBranches,
} from "../../services/bms_black/black-call-center-branches.proxy.service.js";
import {
  resolveBlackTenantProxyContext,
  runBlackProxy,
  singleQuery,
} from "./black-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-black/branches?ownerUid=
 * Upstream: GET https://black.bmspros.com.au/api/call-center/branches?ownerUid=
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 *
 * `ownerUid` query defaults to `X-Tenant-Id` when omitted (matches frontend apiHeaders).
 */
router.get("/branches", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  const ownerUid = singleQuery(req.query.ownerUid) || ctx.tenantId;
  if (!ownerUid) {
    res.status(400).json({
      error: "Missing ownerUid (query param or X-Tenant-Id header).",
    });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterBranches(
      ctx.firebaseIdToken,
      ctx.tenantId,
      ownerUid
    )
  );
});

/**
 * GET /api/bms-black/branches/:branchId
 * Upstream: GET https://black.bmspros.com.au/api/call-center/branches/:branchId
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.get("/branches/:branchId", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  const branchId = String(req.params.branchId ?? "").trim();
  if (!branchId) {
    res.status(400).json({ error: "Missing branch id." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterBranchById(
      ctx.firebaseIdToken,
      ctx.tenantId,
      branchId
    )
  );
});

export default router;
