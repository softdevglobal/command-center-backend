import { Router } from "express";

import { bootstrapSuperAdminSupabase } from "../services/cc-agent/bootstrap-super-admin.service.js";

const router = Router();

/**
 * Super admin bootstrap — one-time (or rare) platform setup.
 *
 * POST — creates the **first** Command Center super admin across Supabase + Firebase Black/Pink/Blue.
 *        No Bearer token required; protected by `x-setup-secret` only (see SETUP_SECRET_KEY in .env).
 *
 * After bootstrap, that user signs in with `POST /api/auth/login` and can register agents via
 * `POST /api/agents/register` using their Supabase `access_token`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 1 — Bootstrap super admin (Postman / curl)
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://127.0.0.1:5000/api/super-admin/register
 *          (use GET http://127.0.0.1:5000/api → listen.port if unsure)
 * Method:  POST
 * Headers:
 *   x-setup-secret: <SETUP_SECRET_KEY>     (same value as in server .env)
 *   Content-Type:   application/json
 *
 * Request body:
 *   {
 *     "email":        "superadmin@yourdomain.com",
 *     "password":     "yourSuperAdminPassword",
 *     "displayName":  "Platform Super Admin"
 *   }
 *   NOTE: password must be at least 6 characters.
 *
 * Success response — 201:
 *   {
 *     "success": true,
 *     "userId": "uuid-from-supabase-auth",
 *     "role": "super_admin",
 *     "firebase": {
 *       "blackUid": "firebase-black-auth-uid",
 *       "pinkUid":  "firebase-pink-auth-uid",
 *       "blueUid":  "firebase-blue-auth-uid",
 *       "warnings": []
 *     },
 *     "message": "Super admin created in Supabase + Firebase Black + Firebase Pink. Sign in with POST /api/auth/login."
 *   }
 *
 * What gets written:
 *   • Supabase `auth.users` + `user_roles` (role = super_admin)
 *   • Firebase Black  `super_admins/{blackUid}`
 *   • Firebase Pink   `super_admins/{pinkUid}`
 *   • Firebase Blue   `super_admins/{blueUid}`   (bmspro-trade)
 *
 * Error responses:
 *   { "error": "Forbidden — set SETUP_SECRET_KEY ..." }                      403
 *   { "error": "email, password, and displayName are required" }             400
 *   { "error": "password must be a string of at least 6 characters" }         400
 *   { "error": "email must be a valid email address" }                       400
 *   { "success": false, "error": "User already registered" }                 400
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 2 — Super admin login (Command Center)
 * ──────────────────────────────────────────────────────────────────────────────
 * URL:     http://127.0.0.1:5000/api/auth/login
 * Method:  POST
 * Headers:
 *   Content-Type: application/json
 * Body:
 *   {
 *     "email":    "superadmin@yourdomain.com",
 *     "password": "yourSuperAdminPassword"
 *   }
 *
 * Copy `access_token` from the response — use as:
 *   Authorization: Bearer <access_token>
 * on protected routes (agent register, agents list, BMS Black proxies, etc.).
 *
 * Session lasts 4 hours (AUTH_SESSION_HOURS). Server auto-refreshes tokens on API calls.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STEP 3 — Optional: Firebase Blue Identity Toolkit token (trade / bmspro-trade)
 * ──────────────────────────────────────────────────────────────────────────────
 * POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<FIREBASE_BLUE_WEB_API_KEY>
 * Body:
 *   {
 *     "email": "superadmin@yourdomain.com",
 *     "password": "yourSuperAdminPassword",
 *     "returnSecureToken": true
 *   }
 * Use the returned `idToken` only when calling trade-native APIs that expect Firebase Bearer
 * (not required for Command Center routes — those use Supabase `access_token`).
 *
 * Required .env for full Firebase provisioning:
 *   SETUP_SECRET_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   FIREBASE_BLACK_PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY (or FIREBASE_BLACK_SERVICE_ACCOUNT)
 *   FIREBASE_PINK_*  (same pattern)
 *   FIREBASE_BLUE_*  (bmspro-trade — same pattern)
 *   FIREBASE_BLACK_WEB_API_KEY, FIREBASE_PINK_WEB_API_KEY (login pipeline)
 *   FIREBASE_BLUE_WEB_API_KEY (optional Identity Toolkit for trade)
 */
router.post("/register", async (req, res) => {
  const secret = req.headers["x-setup-secret"];
  const expected = process.env.SETUP_SECRET_KEY?.trim();
  if (!expected || secret !== expected) {
    res.status(403).json({
      error:
        "Forbidden — set SETUP_SECRET_KEY in .env and send header x-setup-secret with the same value.",
    });
    return;
  }

  const body = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
  };

  if (!body?.email || !body?.password || !body?.displayName) {
    res.status(400).json({
      error: "email, password, and displayName are required",
    });
    return;
  }

  if (typeof body.password !== "string" || body.password.length < 6) {
    res.status(400).json({
      error: "password must be a string of at least 6 characters",
    });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof body.email !== "string" || !emailRegex.test(body.email.trim())) {
    res.status(400).json({ error: "email must be a valid email address" });
    return;
  }

  try {
    const result = await bootstrapSuperAdminSupabase({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });

    const fbBlackOk = !!result.firebase.blackUid;
    const fbPinkOk = !!result.firebase.pinkUid;
    const fbBlueOk = !!result.firebase.blueUid;

    res.status(201).json({
      success: true,
      userId: result.userId,
      role: result.role,
      firebase: {
        ...(result.firebase.blackUid ? { blackUid: result.firebase.blackUid } : {}),
        ...(result.firebase.pinkUid ? { pinkUid: result.firebase.pinkUid } : {}),
        ...(result.firebase.blueUid ? { blueUid: result.firebase.blueUid } : {}),
        warnings: result.firebase.warnings,
      },
      message:
        fbBlackOk && fbPinkOk && fbBlueOk
          ? "Super admin created in Supabase + Firebase Black + Pink + Blue. Sign in with POST /api/auth/login."
          : fbBlackOk && fbPinkOk
            ? "Super admin created in Supabase + Firebase Black + Pink. Blue skipped — see firebase.warnings."
            : "Super admin created in Supabase. Some Firebase steps were skipped — see firebase.warnings.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bootstrap failed";
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
