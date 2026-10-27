import { Router } from "express";

import { attachSupabaseUser } from "../../middleware/supabase-auth.middleware.js";
import {
  proxyPinkCallCenterAgentActivities,
  proxyPinkCallCenterAgentActivitiesList,
  proxyPinkCallCenterCustomerNotifications,
  proxyPinkCallCenterNotificationTracking,
} from "../../services/bms_pink/pink-call-center-activity.proxy.service.js";
import {
  optionalTenantId,
  pickQuery,
  requiredParam,
  resolveFirebasePinkProxyContext,
  runPinkProxy,
} from "./pink-proxy.helpers.js";

const router = Router();

/**
 * GET /api/bms-pink/customer-notifications?all=1&unreadOnly=&limit=&sinceDays=
 * Without `all=1`, send `X-Tenant-Id` (or `?ownerUid=`) for one salon's inbox.
 */
router.get("/customer-notifications", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["all", "scope", "ownerUid", "tenantId", "unreadOnly", "limit", "sinceDays"]);
  await runPinkProxy(res, () =>
    proxyPinkCallCenterCustomerNotifications(ctx.firebaseIdToken, query, optionalTenantId(req))
  );
});

/**
 * POST /api/bms-pink/customer-notifications/:notificationId/notification-reviewed
 *   `{ "notificationReviewed": true | false }`
 * POST /api/bms-pink/customer-notifications/:notificationId/called-customer
 *   `{ "calledCustomer": true | false }`
 */
for (const kind of ["notification-reviewed", "called-customer"] as const) {
  router.post(
    `/customer-notifications/:notificationId/${kind}`,
    attachSupabaseUser,
    async (req, res) => {
      const ctx = await resolveFirebasePinkProxyContext(res);
      if (!ctx) return;
      const notificationId = requiredParam(res, req.params.notificationId, "notification id");
      if (!notificationId) return;
      await runPinkProxy(res, () =>
        proxyPinkCallCenterNotificationTracking(ctx.firebaseIdToken, notificationId, kind, req.body)
      );
    }
  );
}

/**
 * POST /api/bms-pink/agent-activities
 * Body (JSON): `{ ownerId, callId, callerNumber, callerName?, agentNote?, didNumber?, branchId?,
 *   branchName?, queueId?, queueName?, recordingUrl?, recordingFileName? }`
 * Agent identity is taken from the stored Firebase Pink token, not the body.
 */
router.post("/agent-activities", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  await runPinkProxy(res, () =>
    proxyPinkCallCenterAgentActivities(ctx.firebaseIdToken, req.body, optionalTenantId(req))
  );
});

/** GET /api/bms-pink/agent-activities?ownerId=&agentUserId=&agentEmail=&branchId=&callId=&limit= */
router.get("/agent-activities", attachSupabaseUser, async (req, res) => {
  const ctx = await resolveFirebasePinkProxyContext(res);
  if (!ctx) return;
  const query = pickQuery(req, ["ownerId", "ownerUid", "agentUserId", "agentEmail", "branchId", "callId", "limit"]);
  await runPinkProxy(res, () =>
    proxyPinkCallCenterAgentActivitiesList(ctx.firebaseIdToken, query)
  );
});

export default router;
