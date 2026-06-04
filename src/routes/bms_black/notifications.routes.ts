import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlackCallCenterCustomerNotifications,
  proxyBlackCallCenterNotificationCalledCustomer,
  proxyBlackCallCenterNotificationReviewed,
} from "../../services/bms_black/black-call-center-notifications.proxy.service.js";
import {
  resolveFirebaseBlackProxyContext,
  runBlackProxy,
  singleQuery,
} from "./black-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-black/customer-notifications?all=1
 *
 * **Frontend:** `Authorization: Bearer <Supabase access_token>` from login.
 * **Upstream Black:** stored Firebase idToken; `X-Tenant-Id` not required.
 */
router.get("/customer-notifications", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlackProxyContext(res);
  if (!ctx) return;

  const all = singleQuery(req.query.all);
  const query: { all?: string } = {};
  if (all) query.all = all;

  await runBlackProxy(res, () =>
    proxyBlackCallCenterCustomerNotifications(ctx.firebaseIdToken, query)
  );
});

/**
 * POST /api/bms-black/customer-notifications/:notificationId/notification-reviewed
 *
 * Mark reviewed: `{ "notificationReviewed": true }`
 * Unmark: `{ "notificationReviewed": false }`
 */
router.post(
  "/customer-notifications/:notificationId/notification-reviewed",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = await resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const notificationId = String(req.params.notificationId ?? "").trim();
    if (!notificationId) {
      res.status(400).json({ error: "Missing notification id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterNotificationReviewed(
        ctx.firebaseIdToken,
        notificationId,
        req.body
      )
    );
  }
);

/**
 * POST /api/bms-black/customer-notifications/:notificationId/called-customer
 *
 * Logs that the call-center agent contacted the customer.
 */
router.post(
  "/customer-notifications/:notificationId/called-customer",
  attachSupabaseUser,
  async (req, res) => {
    const ctx = await resolveFirebaseBlackProxyContext(res);
    if (!ctx) return;

    const notificationId = String(req.params.notificationId ?? "").trim();
    if (!notificationId) {
      res.status(400).json({ error: "Missing notification id." });
      return;
    }

    await runBlackProxy(res, () =>
      proxyBlackCallCenterNotificationCalledCustomer(
        ctx.firebaseIdToken,
        notificationId,
        req.body
      )
    );
  }
);

export default router;
