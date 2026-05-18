import type { Request, Response } from "express";
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
  proxyBlackCallCenterPatchBookingIssuePrice,
  proxyBlackCallCenterRescheduleBooking,
} from "../../services/bms_black/black-call-center-bookings.proxy.service.js";
import { proxyBlackCallCenterStaff } from "../../services/bms_black/black-call-center-staff.proxy.service.js";
import {
  forwardUpstream,
  resolveBlackTenantProxyContext,
  resolveFirebaseBlackProxyContext,
  runBlackProxy,
  singleQuery,
} from "./black-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-black/getallbooking
 * Upstream: GET https://black.bmspros.com.au/api/call-center/bookings
 * (Firebase Bearer only — no X-Tenant-Id.)
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
 * Upstream: GET https://black.bmspros.com.au/api/call-center/bookings/availability
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
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
 * Upstream: GET https://black.bmspros.com.au/api/call-center/staff
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
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
 * Upstream: POST https://black.bmspros.com.au/api/call-center/bookings
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.post("/bookings", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  await runBlackProxy(res, () =>
    proxyBlackCallCenterCreateBooking(
      ctx.firebaseIdToken,
      ctx.tenantId,
      req.body
    )
  );
});

/**
 * PATCH /api/bms-black/bookings/:bookingId/reschedule
 * Upstream: PATCH https://black.bmspros.com.au/api/call-center/bookings/:bookingId/reschedule
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.patch(
  "/bookings/:bookingId/reschedule",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterRescheduleBooking(
        ctx.firebaseIdToken,
        ctx.tenantId,
        bookingId,
        req.body
      )
    );
  }
);

/**
 * POST /api/bms-black/bookings/:bookingId/cancel
 * Upstream: POST https://black.bmspros.com.au/api/call-center/bookings/:bookingId/cancel
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.post(
  "/bookings/:bookingId/cancel",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterCancelBooking(
        ctx.firebaseIdToken,
        ctx.tenantId,
        bookingId,
        req.body
      )
    );
  }
);

/**
 * GET /api/bms-black/bookings/:bookingId/additional-issues
 * Upstream: GET https://black.bmspros.com.au/api/call-center/bookings/:bookingId/additional-issues
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.get(
  "/bookings/:bookingId/additional-issues",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterBookingAdditionalIssues(
        ctx.firebaseIdToken,
        ctx.tenantId,
        bookingId
      )
    );
  }
);

/**
 * PATCH /api/bms-black/bookings/:bookingId/additional-issues/:issueId
 * Upstream: PATCH https://black.bmspros.com.au/api/call-center/bookings/:bookingId/additional-issues/:issueId
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.patch(
  "/bookings/:bookingId/additional-issues/:issueId",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
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
        ctx.tenantId,
        bookingId,
        issueId,
        req.body
      )
    );
  }
);

/**
 * PATCH /api/bms-black/bookings/:bookingId/additional-issues/:issueId/price
 * Upstream: PATCH https://black.bmspros.com.au/api/call-center/bookings/:bookingId/additional-issues/:issueId/price
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.patch(
  "/bookings/:bookingId/additional-issues/:issueId/price",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
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
      proxyBlackCallCenterPatchBookingIssuePrice(
        ctx.firebaseIdToken,
        ctx.tenantId,
        bookingId,
        issueId,
        req.body
      )
    );
  }
);

/**
 * GET /api/bms-black/bookings/:bookingId
 * Upstream: GET https://black.bmspros.com.au/api/call-center/bookings/:bookingId
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 */
router.get("/bookings/:bookingId", attachSupabaseUser, async (req, res) => {
  const ctx = resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  const bookingId = String(req.params.bookingId ?? "").trim();
  if (!bookingId) {
    res.status(400).json({ error: "Missing booking id." });
    return;
  }

  await runBlackProxy(res, () =>
    proxyBlackCallCenterBookingById(
      ctx.firebaseIdToken,
      ctx.tenantId,
      bookingId
    )
  );
});

/**
 * PATCH /api/bms-black/bookings/:bookingId
 * PUT /api/bms-black/bookings/:bookingId (alias)
 * Upstream: PATCH https://black.bmspros.com.au/api/call-center/bookings/:bookingId
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 * Body: `{ "status": "Confirmed" }` | `"Canceled"` | other workflow status.
 *
 * **Production:** upstream PATCH returns **405** (handler not deployed on Black).
 * - `Canceled` → Command Center proxies to POST .../cancel
 * - `Confirmed` → use POST /api/bms-black/bookings/:bookingId/confirm (staffAssignments)
 */
async function updateBookingStatusHandler(
  req: Request,
  res: Response
): Promise<void> {
  const ctx = resolveBlackTenantProxyContext(req, res);
  if (!ctx) return;

  const bookingId = String(req.params.bookingId ?? "").trim();
  if (!bookingId) {
    res.status(400).json({ error: "Missing booking id." });
    return;
  }

  if (/^(BK-|CC-)/i.test(bookingId)) {
    res.status(400).json({
      error:
        "Use Firestore booking id in the URL (e.g. pApZpWxZLiHeWxQRQatv), not bookingCode (e.g. CC-MPARRD6Y or BK-2026-...).",
    });
    return;
  }

  const body =
    req.body && typeof req.body === "object"
      ? (req.body as { status?: string; reason?: string })
      : {};
  const status = String(body.status ?? "").trim();

  if (status === "Canceled") {
    const cancelBody = body.reason?.trim()
      ? { reason: body.reason.trim() }
      : { reason: "Canceled via Command Center" };
    await runBlackProxy(res, () =>
      proxyBlackCallCenterCancelBooking(
        ctx.firebaseIdToken,
        ctx.tenantId,
        bookingId,
        cancelBody
      )
    );
    return;
  }

  if (status === "Confirmed") {
    res.status(400).json({
      error:
        "BMS Black does not support PATCH for Confirmed. Use POST /api/bms-black/bookings/:bookingId/confirm with staffAssignments.",
      bookingId,
      useInstead: {
        method: "POST",
        path: `/api/bms-black/bookings/${bookingId}/confirm`,
        bodyExample: {
          staffAssignments: {
            SERVICE_LINE_ID: {
              staffId: "STAFF_UID",
              staffName: "Staff Name",
            },
          },
        },
      },
      blackUpstream:
        "PATCH https://black.bmspros.com.au/api/call-center/bookings/:id returns 405 on production.",
    });
    return;
  }

  let upstream: globalThis.Response;
  try {
    upstream = await proxyBlackCallCenterPatchBooking(
      ctx.firebaseIdToken,
      ctx.tenantId,
      bookingId,
      req.body
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upstream request failed";
    res.status(502).json({ success: false, error: msg });
    return;
  }

  if (upstream.status === 405) {
    res.status(405).json({
      error:
        "BMS Black returned 405 — PATCH /api/call-center/bookings/:id is not implemented on production.",
      bookingId,
      hint:
        "Use POST .../confirm (Confirmed) or POST .../cancel (Canceled) instead of PATCH status.",
    });
    return;
  }

  await forwardUpstream(res, upstream);
}

router.patch("/bookings/:bookingId", attachSupabaseUser, updateBookingStatusHandler);
router.put("/bookings/:bookingId", attachSupabaseUser, updateBookingStatusHandler);

/**
 * POST /api/bms-black/bookings/:bookingId/confirm
 * Upstream: POST https://black.bmspros.com.au/api/call-center/bookings/:bookingId/confirm
 * Headers: Authorization + X-Tenant-Id (BMS owner uid).
 * Body: `{ "staffAssignments": { "<serviceLineId>": { "staffId", "staffName" } } }`
 */
router.post(
  "/bookings/:bookingId/confirm",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = resolveBlackTenantProxyContext(req, res);
    if (!ctx) return;

    const bookingId = String(req.params.bookingId ?? "").trim();
    if (!bookingId) {
      res.status(400).json({ error: "Missing booking id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterConfirmBooking(
        ctx.firebaseIdToken,
        ctx.tenantId,
        bookingId,
        req.body
      )
    );
  }
);

export default router;
