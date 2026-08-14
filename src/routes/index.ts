import { Router } from "express";

import { getFirebaseBlackApp } from "../db/firebase/firebase.black.js";
import { getFirebasePinkApp } from "../db/firebase/firebase.pink.js";
import {
  getSupabaseClient,
  getSupabaseConnectionInfo,
} from "../db/supabase/supabase.client.js";
import { requireSuperAdminOrSetup } from "../middleware/super-admin-or-setup.middleware.js";
import agentsRoutes from "./agents.routes.js";
import authRoutes from "./auth.routes.js";
import didMappingsRoutes from "./supabase/did-mappings.routes.js";
import systemAuditLogsRoutes from "./supabase/system-audit-logs.routes.js";
import callsRoutes from "./supabase/calls.routes.js";
import dashboardMetricsRoutes from "./supabase/dashboard-metrics.routes.js";
import agentChatRoutes from "./supabase/agent-chat.routes.js";
import smsRoutes from "./sms.routes.js";
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
import bmsBlackAgentActivityRoutes from "./bms_black/agent-activity/agent-activity.routes.js";
import callCenterAgentActivityRoutes from "./call-center/agent-activities.routes.js";
import bmsBlueSupportChatRoutes from "./bms_blue/chat.routes.js";
import requestsRoutes from "./firebase/requests.routes.js";
import businessRoutes from "./firebase/business.routes.js";
import invoicesRoutes from "./firebase/invoices.routes.js";
import superAdminRoutes from "./super-admin.routes.js";

const router = Router();

/** Public — no route catalogue. */
router.get("/", (_req, res) => {
  res.json({ ok: true });
});

router.use("/super-admin", superAdminRoutes);
router.use("/auth", authRoutes);
router.use("/agents", agentsRoutes);
router.use("/did-mappings", didMappingsRoutes);
router.use("/system-audit-logs", systemAuditLogsRoutes);
router.use("/calls", callsRoutes);
router.use("/requests", requestsRoutes);
router.use("/businesses", businessRoutes);
router.use("/invoices", invoicesRoutes);
router.use("/dashboard", dashboardMetricsRoutes);
router.use("/agent-chat", agentChatRoutes);
router.use("/sms", smsRoutes);
router.use("/agent-attendance", agentAttendanceRoutes);
router.use("/agent-leave-requests", agentLeaveRequestsRoutes);
router.use("/agent-shift-schedules", agentShiftSchedulesRoutes);
router.use("/sales-suburb-workshops", salesSuburbWorkshopsRoutes);
router.use("/sales-agent-suburb-assignments", salesAgentSuburbAssignmentsRoutes);
router.use(
  "/sales-suburb-workshop-agent-contacts",
  salesSuburbWorkshopAgentContactsRoutes
);
router.use("/call-center", callCenterAgentActivityRoutes);
router.use("/bms-black", bmsBlackCallCenterBookingRoutes);
router.use("/bms-black", bmsBlackCallCenterNotificationsRoutes);
router.use("/bms-black", bmsBlackSupportChatRoutes);
router.use("/bms-black", bmsBlackCallCenterServicesRoutes);
router.use("/bms-black", bmsBlackCallCenterBranchRoutes);
router.use("/bms-black", bmsBlackAgentActivityRoutes);
router.use("/bms-blue", bmsBlueSupportChatRoutes);

/** Public health — ok flag only. */
router.get("/health/db", async (_req, res) => {
  const ok = await checkDependenciesOk();
  res.json({ ok });
});

/** Detailed dependency health — super-admin or setup auth only. */
router.get("/health/db/detail", requireSuperAdminOrSetup, async (_req, res) => {
  const detail = await checkDependenciesDetail();
  res.json(detail);
});

async function checkDependenciesOk(): Promise<boolean> {
  const detail = await checkDependenciesDetail();
  return detail.ok;
}

async function checkDependenciesDetail(): Promise<{
  ok: boolean;
  supabase: { ok: boolean; message: string };
  firebaseBlack: { ok: boolean; message: string };
  firebasePink: { ok: boolean; message: string };
}> {
  const supabase = getSupabaseClient();
  let supabaseStatus: { ok: boolean; message: string } = {
    ok: false,
    message: "Supabase not configured.",
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
        supabaseStatus = r.ok
          ? { ok: true, message: "Supabase Auth reachable." }
          : { ok: false, message: `Supabase health HTTP ${r.status}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      supabaseStatus = { ok: false, message: `Supabase check failed: ${msg}` };
    }
  }

  const fbBlack = getFirebaseBlackApp();
  let firebaseBlackStatus: { ok: boolean; message: string };

  if (!fbBlack) {
    firebaseBlackStatus = { ok: false, message: "Firebase Black not configured." };
  } else {
    try {
      await fbBlack.firestore().listCollections();
      firebaseBlackStatus = { ok: true, message: "Firebase Black OK." };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      firebaseBlackStatus = {
        ok: false,
        message: `Firebase Black check failed: ${msg}`,
      };
    }
  }

  const fbPink = getFirebasePinkApp();
  let firebasePinkStatus: { ok: boolean; message: string };

  if (!fbPink) {
    firebasePinkStatus = { ok: false, message: "Firebase Pink not configured." };
  } else {
    try {
      await fbPink.firestore().listCollections();
      firebasePinkStatus = { ok: true, message: "Firebase Pink OK." };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      firebasePinkStatus = {
        ok: false,
        message: `Firebase Pink check failed: ${msg}`,
      };
    }
  }

  return {
    ok:
      supabaseStatus.ok && firebaseBlackStatus.ok && firebasePinkStatus.ok,
    supabase: supabaseStatus,
    firebaseBlack: firebaseBlackStatus,
    firebasePink: firebasePinkStatus,
  };
}

export default router;
