import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlueBookingInspectionRequest,
  proxyBlueBookingSlotAvailability,
} from "../../services/bms_blue/blue-booking.proxy.service.js";
import {
  resolveFirebaseBlueProxyContext,
  runBlueProxy,
  singleQuery,
} from "./blue-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-blue/bookings/availability?businessId=&from=&to=
 * Upstream: GET {TRADE_API_BASE_URL}/api/call-center/bookings/availability
 * Command Center auth: Supabase session with a stored Firebase Blue identity.
 * Trade verifies the Blue agent token and its business assignment.
 */
router.get("/bookings/availability", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;

  const businessId = singleQuery(req.query.businessId);
  const from = singleQuery(req.query.from);
  const to = singleQuery(req.query.to);
  if (!businessId || !from || !to) {
    res.status(400).json({ error: "Missing required query parameters: businessId, from, to." });
    return;
  }

  await runBlueProxy(res, () => proxyBlueBookingSlotAvailability(ctx.firebaseIdToken, { businessId, from, to }));
});

/**
 * POST /api/bms-blue/bookings
 * Upstream: POST {TRADE_API_BASE_URL}/api/call-center/bookings
 * Body: businessId, customer contact, address, service and preferred slots.
 * Trade authenticates the agent separately from the customer being booked.
 */
router.post("/bookings", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.businessId !== "string" || !body.businessId.trim()) {
    res.status(400).json({ error: "Missing required businessId." });
    return;
  }

  await runBlueProxy(res, () => proxyBlueBookingInspectionRequest(ctx.firebaseIdToken, body));
});

export default router;
