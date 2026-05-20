import { Router } from "express";

import { getFirebaseBlackApp } from "../db/firebase/firebase.black.js";
import { getFirebasePinkApp } from "../db/firebase/firebase.pink.js";
import agentsRoutes from "./agents.routes.js";
import authRoutes from "./auth.routes.js";
import didMappingsRoutes from "./supabase/did-mappings.routes.js";
import systemAuditLogsRoutes from "./supabase/system-audit-logs.routes.js";
import callsRoutes from "./supabase/calls.routes.js";
import agentChatRoutes from "./supabase/agent-chat.routes.js";
import agentAttendanceRoutes from "./supabase/agent-attendance.routes.js";
import agentLeaveRequestsRoutes from "./supabase/agent-leave-requests.routes.js";
import bmsBlackCallCenterBookingRoutes from "./bms_black/booking.routes.js";
import bmsBlackSupportChatRoutes from "./bms_black/chat.routes.js";
import bmsBlackCallCenterNotificationsRoutes from "./bms_black/notifications.routes.js";
import bmsBlackCallCenterServicesRoutes from "./bms_black/services.routes.js";
import bmsBlackCallCenterBranchRoutes from "./bms_black/branch.routes.js";
import superAdminRoutes from "./super-admin.routes.js";
import {
  getSupabaseClient,
  getSupabaseConnectionInfo,
} from "../db/supabase/supabase.client.js";

const router = Router();

/** Default local port (matches server.ts). macOS uses :5000 for AirPlay — never default to 5000. */
function advertisedPort(): number {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? n : 5050;
}

router.get("/", (_req, res) => {
  const port = advertisedPort();
  res.json({
    success: true,
    message: "Command Center Backend Running",
    listen: {
      port,
      apiBase: `http://127.0.0.1:${port}/api`,
      loginUrl: `http://127.0.0.1:${port}/api/auth/login`,
      note:
        "On macOS, http://127.0.0.1:5000 is usually AirPlay (ControlCenter), not this app — it returns 403. Use listen.port / loginUrl from THIS response.",
    },
    apis: {
      "POST /api/super-admin/register":
        "Bootstrap super admin (header x-setup-secret + SETUP_SECRET_KEY)",
      "POST /api/auth/login":
        "Sign in — Supabase session; optional Identity Toolkit for Black (FIREBASE_BLACK_WEB_API_KEY → firebaseIdentityToolkit) and Pink (FIREBASE_PINK_WEB_API_KEY → firebasePinkIdentityToolkit).",
      "GET /api/auth/me": "Current profile (Authorization: Bearer access_token)",
      "POST /api/agents/register":
        "Create agent — Bearer (super-admin JWT) OR x-setup-secret = SETUP_SECRET_KEY. Runs on Command Center: Supabase + Firebase Black + Pink (no BMS Black HTTP).",
      "GET /api/bms-black/getallbooking":
        "Proxy Black bookings list — Supabase Bearer; stored Firebase idToken upstream.",
      "GET /api/bms-black/bookings/availability":
        "Booking availability — Supabase Bearer + X-Tenant-Id (owner uid); query branchId, date, serviceIds.",
      "GET /api/bms-black/staff":
        "Workshop staff — Supabase Bearer + X-Tenant-Id; required query branchId; optional role, status.",
      "POST /api/bms-black/bookings":
        "Create booking — Supabase Bearer + X-Tenant-Id (owner uid); JSON body forwarded to Black.",
      "GET /api/bms-black/bookings/:bookingId":
        "Get booking by id — Supabase Bearer + X-Tenant-Id.",
      "PATCH /api/bms-black/bookings/:bookingId":
        "Patch booking workflow status — Supabase Bearer + X-Tenant-Id; body { status: Confirmed|Canceled }.",
      "POST /api/bms-black/bookings/:bookingId/confirm":
        "Confirm booking with staff assignments.",
      "PATCH /api/bms-black/bookings/:bookingId/reschedule":
        "Reschedule booking — body newDate, newTime, reason.",
      "POST /api/bms-black/bookings/:bookingId/cancel":
        "Cancel booking — body reason.",
      "GET /api/bms-black/bookings/:bookingId/additional-issues":
        "List additional issues for a booking.",
      "PATCH /api/bms-black/bookings/:bookingId/additional-issues/:issueId":
        "Customer issue response — body customerResponse accept|reject; optional X-Tenant-Id.",
      "PATCH /api/bms-black/bookings/:bookingId/additional-issues/:issueId/price":
        "Workshop price approve/reject — body status approved|rejected; optional X-Tenant-Id.",
      "GET /api/bms-black/customer-notifications":
        "All call-center notifications — optional query all=1; Supabase Bearer + stored Firebase token.",
      "POST /api/bms-black/customer-notifications/:notificationId/notification-reviewed":
        "Mark/unmark notification reviewed — body notificationReviewed true|false.",
      "POST /api/bms-black/customer-notifications/:notificationId/called-customer":
        "Log that customer was called.",
      "GET /api/bms-black/agent/conversations":
        "Support chat queue + mine — optional query queueLimit, mineLimit, ownerUid, tenantId; optional X-Tenant-Id.",
      "GET /api/bms-black/agent/conversations/:conversationId/messages":
        "Chat messages — optional query limit, before.",
      "POST /api/bms-black/agent/conversations/:conversationId/messages":
        "Send agent message — body { message }.",
      "POST /api/bms-black/agent/conversations/:conversationId/claim": "Claim conversation.",
      "POST /api/bms-black/agent/conversations/:conversationId/read": "Mark conversation read.",
      "POST /api/bms-black/agent/conversations/:conversationId/close":
        "Close conversation — optional body { farewellMessage }.",
      "GET /api/bms-black/chats/workshop-owners":
        "List workshop owners for agent chat — Supabase Bearer + stored Firebase token; optional X-Tenant-Id.",
      "POST /api/bms-black/chats/start-with-owner":
        "Start chat with workshop owner — body { workshopOwnerUid, text? }; optional X-Tenant-Id.",
      "POST /api/bms-black/chats/:chatId/messages":
        "Send message in call-center chat thread — body { text }.",
      "GET /api/bms-black/services":
        "Proxy Black services — Supabase Bearer + X-Tenant-Id.",
      "GET /api/bms-black/services-by-branch":
        "Services for branch — required query branchId.",
      "GET /api/bms-black/services/:id": "Get service by id.",
      "GET /api/bms-black/services/:serviceId/staff":
        "Staff for service — required query branchId, date.",
      "GET /api/bms-black/branches":
        "List branches for owner — Supabase Bearer + X-Tenant-Id; optional query ownerUid (defaults to header).",
      "GET /api/bms-black/branches/:branchId":
        "Get branch by id — Supabase Bearer + X-Tenant-Id.",
      "GET /api/health/db": "Supabase + Firebase connectivity",
      "GET /api/did-mappings":
        "List DID→queue mappings (super-admin Bearer OR x-setup-secret); optional ?tenantId=&queueId=",
      "GET /api/did-mappings/:did": "Get one mapping by DID (URL-encode + if needed)",
      "POST /api/did-mappings":
        "Create DID mapping { did, label, tenantId, queueId, ownerUid, workshopName, branchId, branchName } — same auth as GET",
      "PATCH /api/did-mappings/:did":
        "Partial update — did fixed in URL; send any of label, tenantId, queueId, ownerUid, workshopName, branchId, branchName",
      "DELETE /api/did-mappings/:did":
        "Delete DID mapping by primary key — same auth as GET (URL-encode + if needed)",
      "GET /api/system-audit-logs":
        "List audit logs (super-admin Bearer OR x-setup-secret); ?userId=&action=&resourceType=&resourceId=&from=&to=&limit=&offset=",
      "GET /api/system-audit-logs/:id": "Get one audit log by UUID",
      "GET /api/calls":
        "List calls — super admin: all + recording_url; agent: answered only (no recording_url). Bearer. Filters: callerName, direction=inbound|outbound OR inbound=true|outbound=true, date=YYYY-MM-DD OR from=&to=, tenantId, queueId, agentId (super admin), result, limit, offset",
      "GET /api/calls/:id": "Get one call — same access rules as list",
      "GET /api/agent-chat/conversations":
        "List conversations — agent: own + unread_count; super admin: all; ?participantAgentId=, limit, offset",
      "POST /api/agent-chat/conversations":
        "Get or create chat — body { peerAgentId, selfAgentId? }; super admin or agent (selfAgentId if no agents.user_id link)",
      "GET /api/agent-chat/conversations/:id": "Get one conversation — super admin: any; agent: own only",
      "GET /api/agent-chat/conversations/:id/messages":
        "List messages — super admin: any conversation; agent: own only; ?limit=&offset=&after=",
      "POST /api/agent-chat/conversations/:id/messages":
        "Send message — body { content, selfAgentId? }; must be a conversation participant",
      "POST /api/agent-chat/conversations/:id/read":
        "Mark peer messages read — body optional { selfAgentId }; returns { marked }",
      "GET /api/agent-attendance/status":
        "Current shift state — ?agentId=agents.id (e.g. agent-1777874280295) or ?userId=Auth UUID; returns { agent_id, state, last_event }",
      "GET /api/agent-attendance/reports":
        "Attendance summary — ?groupBy=day|week|month&from=YYYY-MM-DD&to=YYYY-MM-DD; super admin: all agents (+ optional agentId); agent: own only. Returns total_days, total_working_hours, avg_hours_per_day per period",
      "GET /api/agent-attendance/events":
        "List attendance events — agent: own only; super admin: ?agentId= or ?userId= plus tenantId, eventType, from, to, limit, offset",
      "POST /api/agent-attendance/events":
        "Record clock_in|break_start|break_end|clock_out — body { eventType, agentId?|userId?, tenantId?, occurredAt?, agentDisplayName? }; validates state transitions (409 on invalid)",
      "GET /api/agent-attendance/events/:id": "Get one attendance event — agent: own only",
      "GET /api/agent-leave-requests":
        "List leave requests — agent: own only; super admin: all plus ?agentId= or ?userId=, status, tenantId, from, to, limit, offset",
      "POST /api/agent-leave-requests":
        "Apply for leave — body { startDate, endDate, durationType=full_day|half_day, halfDayPart?, reason?, attachmentStoragePath? }",
      "GET /api/agent-leave-requests/:id":
        "Get one leave request — agent: own only; super admin: any",
      "PATCH /api/agent-leave-requests/:id/review":
        "Approve/reject leave request — super admin only; body { status: approved|rejected, reviewComment? }",
    },
  });
});

/** Super admin bootstrap — POST /api/super-admin/register */
router.use("/super-admin", superAdminRoutes);

/** Login + session profile — /api/auth/* */
router.use("/auth", authRoutes);

/** Register agents — POST /api/agents/register (Bearer super-admin OR x-setup-secret + SETUP_SECRET_KEY). */
router.use("/agents", agentsRoutes);

/** DID → tenant / queue — Supabase `did_mappings` (same auth pattern as agents register). */
router.use("/did-mappings", didMappingsRoutes);

/** System audit trail — Supabase `system_audit_logs` (super-admin or x-setup-secret). */
router.use("/system-audit-logs", systemAuditLogsRoutes);

/** Call history — Supabase `calls` (super admin or agent Bearer). */
router.use("/calls", callsRoutes);

/** Internal agent chat — Supabase `agent_conversations` + `agent_messages`. */
router.use("/agent-chat", agentChatRoutes);

/** Agent clock-in/out and breaks — Supabase `agent_attendance_events`. */
router.use("/agent-attendance", agentAttendanceRoutes);

/** Agent leave applications and approvals — Supabase `agent_leave_requests`. */
router.use("/agent-leave-requests", agentLeaveRequestsRoutes);

/** BMS Black proxies (Supabase Bearer + stored Firebase idToken from login). */
router.use("/bms-black", bmsBlackCallCenterBookingRoutes);
router.use("/bms-black", bmsBlackCallCenterNotificationsRoutes);
router.use("/bms-black", bmsBlackSupportChatRoutes);
router.use("/bms-black", bmsBlackCallCenterServicesRoutes);
router.use("/bms-black", bmsBlackCallCenterBranchRoutes);

/** Supabase + Firebase reachability (Firebase is not used to store agents). */
router.get("/health/db", async (_req, res) => {
  const supabase = getSupabaseClient();
  let supabaseStatus: { ok: boolean; message: string } = {
    ok: false,
    message:
      "Missing SUPABASE_URL and key (or use VITE_SUPABASE_* in .env for dev).",
  };

  if (supabase) {
    const info = getSupabaseConnectionInfo();
    try {
      if (!info) {
        supabaseStatus = {
          ok: false,
          message: "Supabase client exists but connection info is missing.",
        };
      } else {
        const healthUrl = `${info.url.replace(/\/$/, "")}/auth/v1/health`;
        const r = await fetch(healthUrl, {
          headers: {
            apikey: info.key,
            Authorization: `Bearer ${info.key}`,
          },
        });
        if (r.ok) {
          supabaseStatus = { ok: true, message: "Supabase Auth reachable." };
        } else {
          supabaseStatus = {
            ok: false,
            message: `Supabase health HTTP ${r.status}`,
          };
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      supabaseStatus = { ok: false, message: `Supabase check failed: ${msg}` };
    }
  }

  const fbBlack = getFirebaseBlackApp();
  let firebaseBlackStatus: { ok: boolean; message: string };

  if (!fbBlack) {
    firebaseBlackStatus = {
      ok: false,
      message:
        "Set FIREBASE_BLACK_* or FIREBASE_SERVICE_ACCOUNT JSON for black.",
    };
  } else {
    try {
      await fbBlack.firestore().listCollections();
      firebaseBlackStatus = {
        ok: true,
        message: "bmspro-black: Admin + Firestore OK.",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      firebaseBlackStatus = {
        ok: false,
        message: `bmspro-black: Firestore check failed: ${msg}`,
      };
    }
  }

  const fbPink = getFirebasePinkApp();
  let firebasePinkStatus: { ok: boolean; message: string };

  if (!fbPink) {
    firebasePinkStatus = {
      ok: false,
      message:
        "Set FIREBASE_PINK_* or FIREBASE_PINK_SERVICE_ACCOUNT for pink.",
    };
  } else {
    try {
      await fbPink.firestore().listCollections();
      firebasePinkStatus = {
        ok: true,
        message: "bmspro-pink: Admin + Firestore OK.",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      firebasePinkStatus = {
        ok: false,
        message: `bmspro-pink: Firestore check failed: ${msg}`,
      };
    }
  }

  res.json({
    success: supabaseStatus.ok && firebaseBlackStatus.ok && firebasePinkStatus.ok,
    supabase: supabaseStatus,
    firebaseBlack: firebaseBlackStatus,
    firebasePink: firebasePinkStatus,
    note: "Agents are stored in Supabase only; Firebase checks are connectivity-only.",
  });
});

export default router;
