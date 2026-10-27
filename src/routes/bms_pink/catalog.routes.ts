import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyPinkCallCenterBranchById,
  proxyPinkCallCenterBranches,
  proxyPinkCallCenterServiceById,
  proxyPinkCallCenterServiceStaff,
  proxyPinkCallCenterServices,
} from "../../services/bms_pink/pink-call-center-catalog.proxy.service.js";
import {
  pickQuery,
  requiredParam,
  resolvePinkTenantProxyContext,
  runPinkProxy,
  singleQuery,
} from "./pink-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-pink/branches?ownerUid=&date=
 * Upstream: GET /api/call-center/branches — `ownerUid` defaults to `X-Tenant-Id`.
 */
router.get("/branches", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const ownerUid = singleQuery(req.query.ownerUid) || ctx.tenantId;
  const date = singleQuery(req.query.date);
  await runPinkProxy(res, () =>
    proxyPinkCallCenterBranches(ctx.firebaseIdToken, ctx.tenantId, {
      ownerUid,
      ...(date ? { date } : {}),
    })
  );
});

/** GET /api/bms-pink/branches/:branchId?date= */
router.get("/branches/:branchId", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const branchId = requiredParam(res, req.params.branchId, "branch id");
  if (!branchId) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterBranchById(ctx.firebaseIdToken, ctx.tenantId, branchId, pickQuery(req, ["date"]))
  );
});

/** GET /api/bms-pink/services — Upstream: GET /api/call-center/services */
router.get("/services", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterServices(ctx.firebaseIdToken, ctx.tenantId, pickQuery(req, ["branchId"]))
  );
});

/** GET /api/bms-pink/services-by-branch?branchId= — Upstream: GET /api/call-center/services?branchId= */
router.get("/services-by-branch", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const branchId = singleQuery(req.query.branchId);
  if (!branchId) {
    res.status(400).json({ error: "Missing required query parameter branchId." });
    return;
  }
  await runPinkProxy(res, () =>
    proxyPinkCallCenterServices(ctx.firebaseIdToken, ctx.tenantId, { branchId })
  );
});

/**
 * GET /api/bms-pink/services/:serviceId/staff?branchId=&date=
 * Upstream: GET /api/call-center/services/:serviceId/staff (both filters optional on Pink).
 */
router.get("/services/:serviceId/staff", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const serviceId = requiredParam(res, req.params.serviceId, "service id");
  if (!serviceId) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterServiceStaff(
      ctx.firebaseIdToken,
      ctx.tenantId,
      serviceId,
      pickQuery(req, ["branchId", "date"])
    )
  );
});

/** GET /api/bms-pink/services/:id — Upstream: GET /api/call-center/services/:id */
router.get("/services/:id", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const serviceId = requiredParam(res, req.params.id, "service id");
  if (!serviceId) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterServiceById(ctx.firebaseIdToken, ctx.tenantId, serviceId)
  );
});

export default router;
