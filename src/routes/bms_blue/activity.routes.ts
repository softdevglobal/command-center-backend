import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyBlueCallCenterAgentActivities,
  proxyBlueCallCenterAgentActivitiesList,
  proxyBlueCallCenterCustomerNotifications,
  proxyBlueCallCenterNotificationTracking,
} from "../../services/bms_blue/blue-call-center-activity.proxy.service.js";
import {
  optionalTenantId,
  pickQuery,
  requiredParam,
  resolveFirebaseBlueProxyContext,
  runBlueProxy,
} from "./blue-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-blue/customer-notifications?all=1&unreadOnly=&limit=&sinceDays=
 * Without `all=1`, send `X-Tenant-Id` (or `?businessId=`) for one business's inbox.
 */
router.get("/customer-notifications", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["all", "scope", "businessId", "unreadOnly", "limit", "sinceDays"]);
  await runBlueProxy(res, () =>
    proxyBlueCallCenterCustomerNotifications(ctx.firebaseIdToken, query, optionalTenantId(req))
  );
});

/**
 * POST /api/bms-blue/customer-notifications/:notificationId/notification-reviewed
 *   `{ "notificationReviewed": true | false }`
 * POST /api/bms-blue/customer-notifications/:notificationId/called-customer
 *   `{ "calledCustomer": true | false }`
 */
for (const kind of ["notification-reviewed", "called-customer"] as const) {
  router.post(
    `/customer-notifications/:notificationId/${kind}`,
    attachSupabaseUser,
    async (req, res) => {
      const ctx = await resolveFirebaseBlueProxyContext(res);
      if (!ctx) return;
      const notificationId = requiredParam(res, req.params.notificationId, "notification id");
      if (!notificationId) return;
      await runBlueProxy(res, () =>
        proxyBlueCallCenterNotificationTracking(ctx.firebaseIdToken, notificationId, kind, req.body)
      );
    }
  );
}

/**
 * POST /api/bms-blue/agent-activities
 * Body: `{ businessId (or ownerId / X-Tenant-Id), callId, callerNumber, callerName?, agentNote?,
 *   didNumber?, queueId?, queueName?, recordingUrl?, recordingFileName? }`
 * Agent identity is taken from the stored Firebase Blue token, not the body.
 */
router.post("/agent-activities", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;
  await runBlueProxy(res, () =>
    proxyBlueCallCenterAgentActivities(ctx.firebaseIdToken, req.body, optionalTenantId(req))
  );
});

/** GET /api/bms-blue/agent-activities?businessId=&agentUserId=&agentEmail=&callId=&limit= */
router.get("/agent-activities", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebaseBlueProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["businessId", "ownerId", "agentUserId", "agentEmail", "callId", "limit"]);
  await runBlueProxy(res, () =>
    proxyBlueCallCenterAgentActivitiesList(ctx.firebaseIdToken, query, optionalTenantId(req))
  );
});

export default router;
