import { Router } from "express";

import { getFirebaseBlackApp } from "../db/firebase/firebase.black.js";
import { getFirebasePinkApp } from "../db/firebase/firebase.pink.js";
import agentsRoutes from "./agents.routes.js";
import authRoutes from "./auth.routes.js";
import bmsBlackCallCenterBookingRoutes from "./bms_black/booking.routes.js";
import bmsBlackCallCenterServicesRoutes from "./bms_black/services.routes.js";
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
        "Sign in — Supabase session; if FIREBASE_BLACK_WEB_API_KEY is set, also Identity Toolkit password sign-in (firebaseIdentityToolkit + server banner).",
      "GET /api/auth/me": "Current profile (Authorization: Bearer access_token)",
      "POST /api/agents/register":
        "Create new agent — super_admin only (Bearer access_token). Delegates to BMS Black so Supabase Auth + agents row + Firebase Black user are created together.",
      "GET /api/bms-black/getallbooking":
        "Proxy Black bookings list — Supabase Bearer; stored Firebase idToken upstream.",
      "GET /api/bms-black/bookings/availability":
        "Booking availability — Supabase Bearer + X-Tenant-Id (owner uid); query branchId, date, serviceIds.",
      "GET /api/bms-black/staff":
        "Workshop staff — Supabase Bearer + X-Tenant-Id; required query branchId; optional role, status.",
      "POST /api/bms-black/bookings": "Create booking — JSON body forwarded to Black.",
      "GET /api/bms-black/bookings/:bookingId": "Get booking by id.",
      "PATCH /api/bms-black/bookings/:bookingId":
        "Patch booking workflow status (e.g. Confirmed, Canceled).",
      "POST /api/bms-black/bookings/:bookingId/confirm":
        "Confirm booking with staff assignments.",
      "PATCH /api/bms-black/bookings/:bookingId/reschedule":
        "Reschedule booking — body newDate, newTime, reason.",
      "POST /api/bms-black/bookings/:bookingId/cancel":
        "Cancel booking — body reason.",
      "GET /api/bms-black/bookings/:bookingId/additional-issues":
        "List additional issues for a booking.",
      "PATCH /api/bms-black/bookings/:bookingId/additional-issues/:issueId":
        "Update issue decision — body customerResponse accept|reject.",
      "GET /api/bms-black/services":
        "Proxy Black services — Supabase Bearer + X-Tenant-Id.",
      "GET /api/bms-black/services-by-branch":
        "Services for branch — required query branchId.",
      "GET /api/bms-black/services/:id": "Get service by id.",
      "GET /api/bms-black/services/:serviceId/staff":
        "Staff for service — required query branchId, date.",
      "GET /api/health/db": "Supabase + Firebase connectivity",
    },
  });
});

/** Super admin bootstrap — POST /api/super-admin/register */
router.use("/super-admin", superAdminRoutes);

/** Login + session profile — /api/auth/* */
router.use("/auth", authRoutes);

/** Register agents — POST /api/agents/register (super_admin Bearer only; Supabase only). */
router.use("/agents", agentsRoutes);

/** BMS Black proxies (Supabase Bearer + stored Firebase idToken from login). */
router.use("/bms-black", bmsBlackCallCenterBookingRoutes);
router.use("/bms-black", bmsBlackCallCenterServicesRoutes);

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
