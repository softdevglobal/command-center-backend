import { Router } from "express";

import { attachSupabaseUser } from "../middleware/supabase-auth.middleware.js";
import {
  loginWithSupabasePassword,
  sessionSummaryFromLocals,
} from "../services/auth/supabase-auth.service.js";

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Works for **super admins** and **agents** (any Supabase user with credentials).
 * Response includes access_token — send as Authorization: Bearer for protected routes.
 *
 * If `FIREBASE_BLACK_WEB_API_KEY` is set, also calls Google Identity Toolkit
 * `accounts:signInWithPassword` for bmspro-black (same email/password).
 * If `FIREBASE_PINK_WEB_API_KEY` is set, same for bmspro-pink (`firebasePinkIdentityToolkit`).
 * After each successful login the **server terminal** prints a bordered
 * `[BMS LOGIN]` summary (Supabase + Firebase SUCCESS / FAILED / SKIPPED).
 * The JSON body may include `firebaseIdentityToolkit` and `firebasePinkIdentityToolkit`.
 */
router.post("/login", async (req, res) => {
  const body = req.body as { email?: string; password?: string };
  if (!body?.email || !body?.password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const result = await loginWithSupabasePassword({
    email: body.email,
    password: body.password,
  });

  if (!result.ok) {
    const status =
      "networkError" in result && result.networkError ? 503 : 401;
    res.status(status).json({ error: result.message });
    return;
  }

  res.json(result.body);
});

/**
 * GET /api/auth/me
 * Authorization: Bearer <access_token from /api/auth/login>
 */
router.get("/me", attachSupabaseUser, (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(500).json({ error: "Internal error" });
    return;
  }
  res.json(sessionSummaryFromLocals(auth));
});

export default router;
