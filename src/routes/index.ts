import { Router } from "express";

import { getFirebaseBlackApp } from "../db/firebase/firebase.black.js";
import { getFirebasePinkApp } from "../db/firebase/firebase.pink.js";
import agentsRoutes from "./agents.routes.js";
import authRoutes from "./auth.routes.js";
import didMappingsRoutes from "./supabase/did-mappings.routes.js";
import systemAuditLogsRoutes from "./supabase/system-audit-logs.routes.js";
import callsRoutes from "./supabase/calls.routes.js";
import dashboardMetricsRoutes from "./supabase/dashboard-metrics.routes.js";
import agentChatRoutes from "./supabase/agent-chat.routes.js";
import agentAttendanceRoutes from "./supabase/agent-attendance.routes.js";
import agentLeaveRequestsRoutes from "./supabase/agent-leave-requests.routes.js";
import agentShiftSchedulesRoutes from "./supabase/agent-shift-schedules.routes.js";
import salesSuburbWorkshopsRoutes from "./supabase/sales-suburb-workshops.routes.js";
import salesAgentSuburbAssignmentsRoutes from "./supabase/sales-agent-suburb-assignments.routes.js";
import salesSuburbWorkshopAgentContactsRoutes from "./supabase/sales-suburb-workshop-agent-contacts.routes.js";
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
        "Sign in — Supabase session; optional Identity Toolkit for Black (FIREBASE_BLACK_WEB_API_KEY → firebaseBlackIdentityToolkit) and Pink (FIREBASE_PINK_WEB_API_KEY → firebasePinkIdentityToolkit).",
      "GET /api/auth/me": "Current profile (Authorization: Bearer access_token)",
      "POST /api/agents/register":
        "Create agent — Bearer (super-admin JWT) OR x-setup-secret = SETUP_SECRET_KEY. Runs on Command Center: Supabase + Firebase Black + Pink (no BMS Black HTTP).",
      "GET /api/agents":
        "List command center and workshop agents — super-admin Bearer OR x-setup-secret; filters: agentType=all|command-centre|command-center|workshop, tenantId, ownerUid, branchId, role, status, search, limit, offset",
      "GET /api/agents/performance":
        "Agent performance from agents + calls — super-admin Bearer OR x-setup-secret; filters: agentId, agentType, tenantId, ownerUid, branchId, queueId, role, status, search, direction=inbound|outbound OR inbound=true|outbound=true, date=YYYY-MM-DD OR from=&to=, limit, offset",
      "GET /api/agents/:id":
        "View one command center or workshop agent — super-admin Bearer OR x-setup-secret.",
      "PATCH /api/agents/:id":
        "Edit command center or workshop agent — super-admin Bearer OR x-setup-secret; body includes name, email, phone/phoneNumber, extension, notes, tenantId, queueIds, allowedQueueIds, role, status, agentType, workshopOwnerUid, workshopBranchId, workshopUserRole.",
      "DELETE /api/agents/:id":
        "Delete one command center or workshop agent — super-admin Bearer OR x-setup-secret; also best-effort removes linked user_roles and Supabase Auth user.",
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
      "GET /api/bms-black/chats/:chatId/messages":
        "List messages in call-center chat thread — optional query limit, before.",
      "POST /api/bms-black/chats/:chatId/messages":
        "Send message in call-center chat thread — body { text }.",
      "POST /api/bms-black/chats/:chatId/close":
        "Close call-center chat (cc_... ids) — optional body { farewellMessage }.",
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
      "POST /api/system-audit-logs":
        "Create audit log — Bearer any logged-in user; body { action, resourceType, resourceId?, details? }",
      "GET /api/system-audit-logs":
        "List audit logs (super-admin Bearer OR x-setup-secret); ?userId=&action=&resourceType=&resourceId=&from=&to=&limit=&offset=",
      "GET /api/system-audit-logs/:id": "Get one audit log by UUID",
      "GET /api/calls":
        "List calls — super admin: all + recording_url; agent: answered only (no recording_url). Bearer. Filters: callerName, direction=inbound|outbound OR inbound=true|outbound=true, date=YYYY-MM-DD OR from=&to=, tenantId, queueId, agentId (super admin), result, limit, offset",
      "GET /api/calls/:id": "Get one call — same access rules as list",
      "GET /api/dashboard/metrics":
        "Dashboard KPIs — super-admin Bearer OR x-setup-secret; returns online_agents_count, today_calls_count, answer_rate_percent, abandon_rate_percent, average_handle_seconds, sla_percent. Filters: date=YYYY-MM-DD OR from=&to=, tenantId, queueId, agentId, direction, onlineStatus, slaSeconds",
      "GET /api/dashboard/online-agents-count":
        "Online agents count — same auth/filtering as dashboard metrics; defaults onlineStatus=online.",
      "GET /api/dashboard/today-calls-count":
        "Today's calls count — same auth/filtering as dashboard metrics.",
      "GET /api/dashboard/answer-rate":
        "Answer rate percentage — same auth/filtering as dashboard metrics.",
      "GET /api/dashboard/abandon-rate":
        "Abandon rate percentage — same auth/filtering as dashboard metrics.",
      "GET /api/dashboard/avg-handle":
        "Average handle time in seconds — same auth/filtering as dashboard metrics.",
      "GET /api/dashboard/sla":
        "SLA percentage — answered calls within slaSeconds (default 20) divided by answered calls.",
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
      "DELETE /api/agent-leave-requests/:id":
        "Delete own pending leave request — agent only; approved/rejected requests cannot be deleted",
      "PATCH /api/agent-leave-requests/:id/review":
        "Approve/reject leave request — super admin only; body { status: approved|rejected, reviewComment? }",
      "GET /api/agent-shift-schedules":
        "List shift schedules — agent: own only; super admin: all plus ?agentId= or ?userId=, limit, offset",
      "GET /api/agent-shift-schedules/me":
        "Current agent's assigned shift schedule",
      "GET /api/agent-shift-schedules/:agentId":
        "Get one shift schedule by agents.id — agent: own only; super admin: any",
      "PUT /api/agent-shift-schedules/:agentId":
        "Create/update a shift schedule — super admin only; body { monday?, tuesday?, wednesday?, thursday?, friday?, saturday?, sunday? } values are text or null",
      "GET /api/sales-suburb-workshops":
        "List workshop suburbs — super admin: all; agent: assigned suburbs only. Filters: tenantId, suburb, search, limit, offset",
      "POST /api/sales-suburb-workshops":
        "Create workshop suburb — super admin only; body { tenantId, suburb, workshopName?, phoneNumber?, ownerName?, ownerEmail?, location?, website? }",
      "GET /api/sales-suburb-workshops/:id":
        "View one workshop suburb row — super admin: any; agent: assigned suburb only.",
      "PATCH /api/sales-suburb-workshops/:id":
        "Edit workshop suburb row — super admin only; body may include tenantId, suburb, workshopName, phoneNumber, ownerName, ownerEmail, location, website.",
      "DELETE /api/sales-suburb-workshops/:id":
        "Delete workshop suburb row — super admin only.",
      "GET /api/sales-agent-suburb-assignments":
        "List sales agent suburb assignments — super admin: all; agent: own only. Filters: tenantId, agentId, suburb, search, limit, offset",
      "POST /api/sales-agent-suburb-assignments":
        "Assign an agent to a suburb — super admin only; body { tenantId, agentId, suburb }",
      "GET /api/sales-agent-suburb-assignments/:id":
        "View one sales agent suburb assignment — super admin: any; agent: own only.",
      "PATCH /api/sales-agent-suburb-assignments/:id":
        "Edit a sales agent suburb assignment — super admin only; body may include tenantId, agentId, suburb.",
      "DELETE /api/sales-agent-suburb-assignments/:id":
        "Delete a sales agent suburb assignment — super admin only.",
      "GET /api/sales-suburb-workshop-agent-contacts":
        "List workshop agent contact rows — super admin: all; agent: own only. Filters: tenantId, workshopId, agentId, callStatus, from, to, limit, offset",
      "GET /api/sales-suburb-workshop-agent-contacts/workshops/:workshopId":
        "Get one contact row by workshop — agent: own row; super admin: pass ?agentId=.",
      "POST /api/sales-suburb-workshop-agent-contacts":
        "Create workshop contact row — agent: assigned workshops only; super admin: any. Body { workshopId, agentId?, callStatus?, firstCalledAt?, followUpAt?, remarks? }",
      "GET /api/sales-suburb-workshop-agent-contacts/:id":
        "View one workshop contact row — super admin: any; agent: own only.",
      "PATCH /api/sales-suburb-workshop-agent-contacts/:id":
        "Update workshop contact row — agent: own callStatus/firstCalledAt/followUpAt/remarks only; super admin: any patchable field.",
      "DELETE /api/sales-suburb-workshop-agent-contacts/:id":
        "Delete workshop contact row — super admin only.",
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

/** Dashboard call-center KPIs — Supabase `agents` + `calls`. */
router.use("/dashboard", dashboardMetricsRoutes);

/** Internal agent chat — Supabase `agent_conversations` + `agent_messages`. */
router.use("/agent-chat", agentChatRoutes);

/** Agent clock-in/out and breaks — Supabase `agent_attendance_events`. */
router.use("/agent-attendance", agentAttendanceRoutes);

/** Agent leave applications and approvals — Supabase `agent_leave_requests`. */
router.use("/agent-leave-requests", agentLeaveRequestsRoutes);

/** Agent weekly shift schedules — Supabase `agent_shift_schedules`. */
router.use("/agent-shift-schedules", agentShiftSchedulesRoutes);

/** Sales workshop suburbs — Supabase `sales_suburb_workshops`. */
router.use("/sales-suburb-workshops", salesSuburbWorkshopsRoutes);

/** Sales agent suburb assignments — Supabase `sales_agent_suburb_assignments`. */
router.use("/sales-agent-suburb-assignments", salesAgentSuburbAssignmentsRoutes);

/** Sales workshop agent contact tracking — Supabase `sales_suburb_workshop_agent_contact`. */
router.use(
  "/sales-suburb-workshop-agent-contacts",
  salesSuburbWorkshopAgentContactsRoutes
);

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
