import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlueCallCenterServiceById,
  proxyBlueCallCenterServiceStaff,
  proxyBlueCallCenterServices,
  proxyBlueCallCenterWorkshops,
} from "../../services/bms_blue/blue-call-center-catalog.proxy.service.js";
import {
  pickQuery,
  requiredParam,
  resolveBlueTenantProxyContext,
  resolveFirebaseBlueProxyContext,
  runBlueProxy,
} from "./blue-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-blue/workshops?summary=1
 * Upstream: GET /api/call-center/workshops — businesses the agent can work with.
 * No tenant needed.
 */
router.get("/workshops", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterWorkshops(ctx.firebaseIdToken, pickQuery(req, ["summary"]))
  );
});

/** GET /api/bms-blue/services?activeOnly=false — Upstream: GET /api/call-center/services */
router.get("/services", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterServices(ctx.firebaseIdToken, ctx.tenantId, pickQuery(req, ["activeOnly"]))
  );
});

/**
 * GET /api/bms-blue/services/:serviceId/staff?date=
 * Upstream: GET /api/call-center/services/:serviceId/staff
 */
router.get("/services/:serviceId/staff", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  const serviceId = requiredParam(res, req.params.serviceId, "service id");
  if (!serviceId) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterServiceStaff(ctx.firebaseIdToken, ctx.tenantId, serviceId, pickQuery(req, ["date"]))
  );
});

/** GET /api/bms-blue/services/:id — Upstream: GET /api/call-center/services/:id */
router.get("/services/:id", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  const serviceId = requiredParam(res, req.params.id, "service id");
  if (!serviceId) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterServiceById(ctx.firebaseIdToken, ctx.tenantId, serviceId)
  );
});

export default router;
