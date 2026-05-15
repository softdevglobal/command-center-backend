import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlackCallCenterServiceById,
  proxyBlackCallCenterServiceStaff,
  proxyBlackCallCenterServices,
  proxyBlackCallCenterServicesByBranch,
} from "../../services/bms_black/black-call-center-services.proxy.service.js";
import {
  resolveBlackTenantProxyContext,
  runBlackProxy,
  singleQuery,
} from "./black-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-black/services
 * Upstream: GET /api/call-center/services
 */
router.get("/services", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;
  await runBlackProxy(res, () =>
    proxyBlackCallCenterServices(ctx.firebaseIdToken, ctx.tenantId)
  );
});

/**
 * GET /api/bms-black/services-by-branch?branchId=...
 * Upstream: GET /api/call-center/services?branchId=...
 */
router.get("/services-by-branch", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  const branchId = singleQuery(req.query.branchId);
  if (!branchId) {
    res.status(400).json({
      error: "Missing required query parameter branchId.",
    });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterServicesByBranch(
      ctx.firebaseIdToken,
      ctx.tenantId,
      branchId
    )
  );
});

/**
 * GET /api/bms-black/services/:serviceId/staff?branchId=&date=
 * Upstream: GET /api/call-center/services/:serviceId/staff
 */
router.get(
  "/services/:serviceId/staff",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
    if (!ctx) return;

    const serviceId = String(req.params.serviceId ?? "").trim();
    if (!serviceId) {
      res.status(400).json({ error: "Missing service id." });
      return;
    }

    const branchId = singleQuery(req.query.branchId);
    const date = singleQuery(req.query.date);
    if (!branchId || !date) {
      res.status(400).json({
        error: "Missing required query parameters: branchId, date.",
      });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterServiceStaff(
        ctx.firebaseIdToken,
        ctx.tenantId,
        serviceId,
        { branchId, date }
      )
    );
  }
);

/**
 * GET /api/bms-black/services/:id
 * Upstream: GET /api/call-center/services/:id
 */
router.get("/services/:id", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  const serviceId = String(req.params.id ?? "").trim();
  if (!serviceId) {
    res.status(400).json({ error: "Missing service id." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterServiceById(
      ctx.firebaseIdToken,
      ctx.tenantId,
      serviceId
    )
  );
});

export default router;
