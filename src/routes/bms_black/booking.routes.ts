import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlackCallCenterBookingAdditionalIssues,
  proxyBlackCallCenterBookingAvailability,
  proxyBlackCallCenterBookingById,
  proxyBlackCallCenterBookings,
  proxyBlackCallCenterCancelBooking,
  proxyBlackCallCenterConfirmBooking,
  proxyBlackCallCenterCreateBooking,
  proxyBlackCallCenterPatchBooking,
  proxyBlackCallCenterPatchBookingIssue,
  proxyBlackCallCenterRescheduleBooking,
} from "../../services/bms_black/black-call-center-bookings.proxy.service.js";
import { proxyBlackCallCenterStaff } from "../../services/bms_black/black-call-center-staff.proxy.service.js";
import {
  resolveBlackTenantProxyContext,
  resolveFirebaseBlackProxyContext,
  runBlackProxy,
  singleQuery,
} from "./black-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-black/getallbooking
 * Upstream: GET /api/call-center/bookings
 */
router.get("/getallbooking", attachSupabaseUser, async (_req, res) => {
  const ctx = resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;
  await runBlackProxy(res, () =>
    proxyBlackCallCenterBookings(ctx.firebaseIdToken)
  );
});

/**
 * GET /api/bms-black/bookings/availability?branchId=&date=&serviceIds=
 * Headers: Authorization + X-Tenant-Id (owner uid, same as services routes).
 * Upstream: GET /api/call-center/bookings/availability
 */
router.get(
  "/bookings/availability",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
    if (!ctx) return;

    const branchId = singleQuery(req.query.branchId);
    const date = singleQuery(req.query.date);
    const serviceIds = singleQuery(req.query.serviceIds);
    if (!branchId || !date || !serviceIds) {
      res.status(400).json({
        error:
          "Missing required query parameters: branchId, date, serviceIds.",
      });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterBookingAvailability(
        ctx.firebaseIdToken,
        ctx.tenantId,
        { branchId, date, serviceIds }
      )
    );
  }
);

/**
 * GET /api/bms-black/staff?branchId=&role=&status=
 * Headers: Authorization + X-Tenant-Id (owner uid).
 * Upstream: GET /api/call-center/staff
 */
router.get("/staff", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  const branchId = singleQuery(req.query.branchId);
  if (!branchId) {
    res.status(400).json({
      error: "Missing required query parameter branchId.",
    });
    return;
  }

  const staffQuery: {
    branchId: string;
    role?: string;
    status?: string;
  } = { branchId };
  const role = singleQuery(req.query.role);
  const status = singleQuery(req.query.status);
  if (role) staffQuery.role = role;
  if (status) staffQuery.status = status;

  await runBlackProxy(res, () =>
    proxyBlackCallCenterStaff(ctx.firebaseIdToken, ctx.tenantId, staffQuery)
  );
});

/**
 * POST /api/bms-black/bookings
 * Upstream: POST /api/call-center/bookings
 */
router.post("/bookings", attachSupabaseUser, async (req, res) => {
  const ctx = resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  await runBlackProxy(res, () =>
    proxyBlackCallCenterCreateBooking(ctx.firebaseIdToken, req.body)
  );
});

/**
 * PATCH /api/bms-black/bookings/:bookingId/reschedule
 * Upstream: PATCH /api/call-center/bookings/:bookingId/reschedule
 */
router.patch(
  "/bookings/:bookingId/reschedule",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterRescheduleBooking(
        ctx.firebaseIdToken,
        bookingId,
        req.body
      )
    );
  }
);

/**
 * POST /api/bms-black/bookings/:bookingId/cancel
 * Upstream: POST /api/call-center/bookings/:bookingId/cancel
 */
router.post(
  "/bookings/:bookingId/cancel",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterCancelBooking(
        ctx.firebaseIdToken,
        bookingId,
        req.body
      )
    );
  }
);

/**
 * GET /api/bms-black/bookings/:bookingId/additional-issues
 * Upstream: GET /api/call-center/bookings/:bookingId/additional-issues
 */
router.get(
  "/bookings/:bookingId/additional-issues",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterBookingAdditionalIssues(
        ctx.firebaseIdToken,
        bookingId
      )
    );
  }
);

/**
 * PATCH /api/bms-black/bookings/:bookingId/additional-issues/:issueId
 * Upstream: PATCH /api/call-center/bookings/:bookingId/additional-issues/:issueId
 */
router.patch(
  "/bookings/:bookingId/additional-issues/:issueId",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    const issueId = String(req.params.issueId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }
    if (!issueId) {
      res.status(400).json({ error: "Missing issue id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterPatchBookingIssue(
        ctx.firebaseIdToken,
        bookingId,
        issueId,
        req.body
      )
    );
  }
);

/**
 * GET /api/bms-black/bookings/:bookingId
 * Upstream: GET /api/call-center/bookings/:bookingId
 */
router.get("/bookings/:bookingId", attachSupabaseUser, async (req, res) => {
  const ctx = resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const bookingId = String(req.params.bookingId ?? "").trim();
  if (!bookingId) {
    res.status(400).json({ error: "Missing booking id." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterBookingById(ctx.firebaseIdToken, bookingId)
  );
});

/**
 * PATCH /api/bms-black/bookings/:bookingId
 * Upstream: PATCH /api/call-center/bookings/:bookingId (body: { status })
 */
router.patch("/bookings/:bookingId", attachSupabaseUser, async (req, res) => {
  const ctx = resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const bookingId = String(req.params.bookingId ?? "").trim();
  if (!bookingId) {
    res.status(400).json({ error: "Missing booking id." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterPatchBooking(
      ctx.firebaseIdToken,
      bookingId,
      req.body
    )
  );
});

/**
 * POST /api/bms-black/bookings/:bookingId/confirm
 * Upstream: POST /api/call-center/bookings/:bookingId/confirm
 */
router.post(
  "/bookings/:bookingId/confirm",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterConfirmBooking(
        ctx.firebaseIdToken,
        bookingId,
        req.body
      )
    );
  }
);

export default router;
