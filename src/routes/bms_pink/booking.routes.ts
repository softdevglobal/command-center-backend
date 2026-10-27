import type { Request, Response } from "express";
import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyPinkCallCenterBookingAction,
  proxyPinkCallCenterBookingAvailability,
  proxyPinkCallCenterBookingById,
  proxyPinkCallCenterBookings,
  proxyPinkCallCenterCreateBooking,
  proxyPinkCallCenterPatchBooking,
  proxyPinkCallCenterRescheduleBooking,
} from "../../services/bms_pink/pink-call-center-bookings.proxy.service.js";
import { proxyPinkCallCenterStaff } from "../../services/bms_pink/pink-call-center-catalog.proxy.service.js";
import { findPinkBookingsByPhoneInFirestore } from "../../services/firestore/pink-bookings.firestore.service.js";
import {
  optionalTenantId,
  pickQuery,
  requiredParam,
  resolveFirebasePinkProxyContext,
  resolvePinkTenantProxyContext,
  runPinkProxy,
  singleQuery,
} from "./pink-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-pink/getallbooking?status=&date=&branchId=&limit=&all=
 * Upstream: GET {PINK_API_BASE_URL}/api/call-center/bookings
 * `X-Tenant-Id` optional — without it, every salon the agent can see.
 */
router.get("/getallbooking", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["status", "date", "branchId", "customerUid", "limit", "all"]);
  await runPinkProxy(res, () =>
    proxyPinkCallCenterBookings(ctx.firebaseIdToken, query, optionalTenantId(req))
  );
});

/**
 * GET /api/bms-pink/bookings/availability?branchId=&date=&serviceIds=&staffId=&interval=
 * Upstream: GET /api/call-center/bookings/availability — Authorization + X-Tenant-Id.
 * `serviceIds` (comma separated) and `staffId` are optional on Pink.
 */
router.get("/bookings/availability", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;

  const query = pickQuery(req, ["branchId", "date", "serviceIds", "staffId", "interval"]);
  if (!query.branchId || !query.date) {
    res.status(400).json({ error: "Missing required query parameters: branchId, date." });
    return;
  }
  await runPinkProxy(res, () =>
    proxyPinkCallCenterBookingAvailability(ctx.firebaseIdToken, ctx.tenantId, query)
  );
});

/**
 * GET /api/bms-pink/bookings/by-phone?phone=&ownerUid=
 * Firestore root `bookings` on bmspro-pink via Admin SDK (not the Pink HTTP API).
 * Always 200 with `{ bookings: [...] }`.
 */
router.get("/bookings/by-phone", attachSupabaseUser, async (req, res) => {
  const phone = singleQuery(req.query.phone);
  if (!phone) {
    res.status(400).json({ error: "Missing required query parameter phone." });
    return;
  }
  const ownerUid = singleQuery(req.query.ownerUid);

  try {
    const bookings = await findPinkBookingsByPhoneInFirestore({
      phone,
      ...(ownerUid ? { ownerUid } : {}),
    });
    res.json({ bookings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to look up bookings by phone.";
    console.error(`[bms-pink bookings/by-phone] ${msg}`);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/bms-pink/staff?branchId=&role=&status=
 * Upstream: GET /api/call-center/staff — Authorization + X-Tenant-Id.
 */
router.get("/staff", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterStaff(
      ctx.firebaseIdToken,
      ctx.tenantId,
      pickQuery(req, ["branchId", "role", "status"])
    )
  );
});

/**
 * POST /api/bms-pink/bookings
 * Upstream: POST /api/call-center/bookings — Authorization + X-Tenant-Id.
 * Body: `{ branchId, date, time, client, clientPhone, clientEmail?, notes?, services: [{ serviceId, staffId?, time? }] }`
 */
router.post("/bookings", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterCreateBooking(ctx.firebaseIdToken, ctx.tenantId, req.body)
  );
});

/**
 * PATCH /api/bms-pink/bookings/:bookingId/reschedule
 * Body: `{ newDate, newTime, reason?, newStaffId?, newStaffName?, staffAssignments? }`
 */
router.patch("/bookings/:bookingId/reschedule", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const bookingId = requiredParam(res, req.params.bookingId, "booking id");
  if (!bookingId) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterRescheduleBooking(ctx.firebaseIdToken, ctx.tenantId, bookingId, req.body)
  );
});

/**
 * POST /api/bms-pink/bookings/:bookingId/{confirm|cancel|complete}
 * confirm body: `{ staffAssignments?: { "<serviceId>": { staffId, staffName } }, staffId?, staffName? }`
 * cancel body:  `{ reason? }`
 */
for (const action of ["confirm", "cancel", "complete"] as const) {
  router.post(`/bookings/:bookingId/${action}`, attachSupabaseUser, async (req, res) => {
    const ctx = await resolvePinkTenantProxyContext(req, res);
    if (!ctx) return;
    const bookingId = requiredParam(res, req.params.bookingId, "booking id");
    if (!bookingId) return;
    await runPinkProxy(res, () =>
      proxyPinkCallCenterBookingAction(ctx.firebaseIdToken, ctx.tenantId, bookingId, action, req.body)
    );
  });
}

/**
 * GET /api/bms-pink/bookings/:bookingId — id or bookingCode.
 */
router.get("/bookings/:bookingId", attachSupabaseUser, async (req, res) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const bookingId = requiredParam(res, req.params.bookingId, "booking id");
  if (!bookingId) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterBookingById(ctx.firebaseIdToken, ctx.tenantId, bookingId)
  );
});

/**
 * PATCH /api/bms-pink/bookings/:bookingId
 * PUT   /api/bms-pink/bookings/:bookingId (alias)
 * Body: `{ "status": "Confirmed" | "Canceled" | "Completed", ... }` — Pink handles this natively
 * (same handler as the confirm / cancel / complete routes).
 */
const updateBookingStatus = async (req: Request, res: Response) => {
  const ctx = await resolvePinkTenantProxyContext(req, res);
  if (!ctx) return;
  const bookingId = requiredParam(res, req.params.bookingId, "booking id");
  if (!bookingId) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterPatchBooking(ctx.firebaseIdToken, ctx.tenantId, bookingId, req.body)
  );
};
router.patch("/bookings/:bookingId", attachSupabaseUser, updateBookingStatus);
router.put("/bookings/:bookingId", attachSupabaseUser, updateBookingStatus);

export default router;
