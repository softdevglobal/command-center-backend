import { Router } from "express";

import { getFirebaseBlackApp } from "../db/firebase/firebase.black.js";
import { getFirebasePinkApp } from "../db/firebase/firebase.pink.js";
import {
  getSupabaseClient,
  getSupabaseConnectionInfo,
} from "../db/supabase/supabase.client.js";

const router = Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Command Center Backend Running"
  });
});

/** Verifies Supabase (Auth REST) and Firebase Admin (optional) for local testing. */
router.get("/health/db", async (_req, res) => {
  const supabase = getSupabaseClient();
  let supabaseStatus: { ok: boolean; message: string } = {
    ok: false,
    message: "Missing SUPABASE_URL and key (or use VITE_SUPABASE_* in .env for dev).",
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
        "Set FIREBASE_BLACK_PROJECT_ID, FIREBASE_BLACK_CLIENT_EMAIL, FIREBASE_BLACK_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT JSON).",
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
        "Set FIREBASE_PINK_PROJECT_ID, FIREBASE_PINK_CLIENT_EMAIL, FIREBASE_PINK_PRIVATE_KEY (or FIREBASE_PINK_SERVICE_ACCOUNT JSON).",
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
    success:
      supabaseStatus.ok &&
      firebaseBlackStatus.ok &&
      firebasePinkStatus.ok,
    supabase: supabaseStatus,
    firebaseBlack: firebaseBlackStatus,
    firebasePink: firebasePinkStatus,
  });
});

export default router;