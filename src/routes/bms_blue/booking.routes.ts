import type { Request, Response } from "express";
import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlueCallCenterBookingAction,
  proxyBlueCallCenterBookingAvailability,
  proxyBlueCallCenterBookingById,
  proxyBlueCallCenterBookings,
  proxyBlueCallCenterCreateBooking,
  proxyBlueCallCenterPatchBooking,
  proxyBlueCallCenterRescheduleBooking,
} from "../../services/bms_blue/blue-call-center-bookings.proxy.service.js";
import { proxyBlueCallCenterStaff } from "../../services/bms_blue/blue-call-center-catalog.proxy.service.js";
import {
  optionalTenantId,
  pickQuery,
  requiredParam,
  resolveBlueTenantProxyContext,
  resolveFirebaseBlueProxyContext,
  runBlueProxy,
  singleQuery,
} from "./blue-proxy.helpers.js";

/**
 * BMS Trade call-center bookings. On Trade a booking is an inspection request;
 * `X-Tenant-Id` is the Trade businessId.
 */
const router = Router();

/**
 * GET /api/bms-blue/getallbooking?status=&date=&phone=&createdSource=&limit=&all=
 * Upstream: GET {BLUE_API_BASE_URL}/api/call-center/bookings
 * `X-Tenant-Id` optional — without it, every business assigned to the agent.
 */
router.get("/getallbooking", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["status", "date", "phone", "createdSource", "limit", "all"]);
  await runBlueProxy(res, () =>
    proxyBlueCallCenterBookings(ctx.firebaseIdToken, query, optionalTenantId(req))
  );
});

/**
 * GET /api/bms-blue/bookings/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Upstream: GET /api/call-center/bookings/availability — `{ ok, unavailable: [...] }`.
 * Range must be 1–90 days.
 */
router.get("/bookings/availability", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  const query = pickQuery(req, ["from", "to"]);
  if (!query.from || !query.to) {
    res.status(400).json({ error: "Missing required query parameters: from, to." });
    return;
  }
  await runBlueProxy(res, () =>
    proxyBlueCallCenterBookingAvailability(ctx.firebaseIdToken, ctx.tenantId, query)
  );
});

/**
 * GET /api/bms-blue/bookings/by-phone?phone=
 * Upstream: GET /api/call-center/bookings?phone= (matches the last 9 digits).
 * `X-Tenant-Id` optional, as for /getallbooking.
 */
router.get("/bookings/by-phone", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;
  const phone = singleQuery(req.query.phone);
  if (!phone) {
    res.status(400).json({ error: "Missing required query parameter phone." });
    return;
  }
  await runBlueProxy(res, () =>
    proxyBlueCallCenterBookings(ctx.firebaseIdToken, { phone, limit: "50" }, optionalTenantId(req))
  );
});

/** GET /api/bms-blue/staff?status= — Upstream: GET /api/call-center/staff */
router.get("/staff", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterStaff(ctx.firebaseIdToken, ctx.tenantId, pickQuery(req, ["status"]))
  );
});

/**
 * POST /api/bms-blue/bookings — creates an inspection request.
 * Body: `{ requestType: "existing_service", serviceId, customer: { fullName, email, phone },
 *   address: { street, suburb, state, postcode }, preferredSlots: [{ date, timeRange }], customerNotes? }`
 */
router.post("/bookings", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterCreateBooking(ctx.firebaseIdToken, ctx.tenantId, req.body)
  );
});

/**
 * PATCH /api/bms-blue/bookings/:bookingId/reschedule
 * Body: `{ newDate, newTime, newEndTime?, timeRange?, reason?, newStaffId? }`
 */
router.patch("/bookings/:bookingId/reschedule", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  const bookingId = requiredParam(res, req.params.bookingId, "booking id");
  if (!bookingId) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterRescheduleBooking(ctx.firebaseIdToken, ctx.tenantId, bookingId, req.body)
  );
});

/**
 * POST /api/bms-blue/bookings/:bookingId/{confirm|cancel|complete}
 * confirm body: `{ date?, startTime, endTime?, durationMinutes?, staffId?, note? }`
 * cancel body:  `{ reason? }`
 * complete:     Trade only completes once a quotation exists (usually 400).
 */
for (const action of ["confirm", "cancel", "complete"] as const) {
  router.post(`/bookings/:bookingId/${action}`, attachSupabaseUser, async (req, res) => {
    const ctx = await resolveBlueTenantProxyContext(req, res);
    if (!ctx) return;
    const bookingId = requiredParam(res, req.params.bookingId, "booking id");
    if (!bookingId) return;
    await runBlueProxy(res, () =>
      proxyBlueCallCenterBookingAction(ctx.firebaseIdToken, ctx.tenantId, bookingId, action, req.body)
    );
  });
}

/** GET /api/bms-blue/bookings/:bookingId — id or request code. */
router.get("/bookings/:bookingId", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  const bookingId = requiredParam(res, req.params.bookingId, "booking id");
  if (!bookingId) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterBookingById(ctx.firebaseIdToken, ctx.tenantId, bookingId)
  );
});

/**
 * PATCH /api/bms-blue/bookings/:bookingId
 * PUT   /api/bms-blue/bookings/:bookingId (alias)
 * Body: `{ "status": "scheduled" | "cancelled" | "completed", ... }` (Pink spellings accepted).
 */
const updateBookingStatus = async (req: Request, res: Response) => {
  const ctx = await resolveBlueTenantProxyContext(req, res);
  if (!ctx) return;
  const bookingId = requiredParam(res, req.params.bookingId, "booking id");
  if (!bookingId) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterPatchBooking(ctx.firebaseIdToken, ctx.tenantId, bookingId, req.body)
  );
};
router.patch("/bookings/:bookingId", attachSupabaseUser, updateBookingStatus);
router.put("/bookings/:bookingId", attachSupabaseUser, updateBookingStatus);

export default router;
