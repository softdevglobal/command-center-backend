import { Router } from "express";

import { attachSupabaseUser } from "../middleware/supabase-auth.middleware.js";
import {
  firebaseBlackUidForSupabaseUser,
  loginWithSupabasePassword,
  refreshSupabaseAuthSession,
  sessionSummaryFromLocals,
} from "../services/auth/supabase-auth.service.js";
import { createSystemAuditLog } from "../services/system-audit-logs.service.js";

const router = Router();

function loginUserName(input: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  const displayName = input.user_metadata?.display_name;
  if (typeof displayName === "string" && displayName.trim()) {
    return displayName.trim();
  }
  const fullName = input.user_metadata?.full_name;
  if (typeof fullName === "string" && fullName.trim()) {
    return fullName.trim();
  }
  return input.email ?? "Unknown user";
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Works for **super admins** and **agents** (any Supabase user with credentials).
 * Response includes access_token — send as Authorization: Bearer for protected routes.
 * Sessions last **4 hours** (`AUTH_SESSION_HOURS`): Supabase access_token and Firebase
 * Black/Pink idTokens are auto-refreshed on each API call. Login JSON includes
 * `sessionValidUntil` / `sessionValidHours`. Optional: POST /api/auth/refresh with
 * `refresh_token`, or read `X-Supabase-Access-Token` from API responses when rotated.
 * `accounts:signInWithPassword` for bmspro-black (same email/password).
 * If `FIREBASE_PINK_WEB_API_KEY` is set, same for bmspro-pink (`firebasePinkIdentityToolkit`).
 * After each successful login the **server terminal** prints a bordered
 * `[BMS LOGIN]` summary (Supabase + Firebase SUCCESS / FAILED / SKIPPED).
 * The JSON body may include `firebaseBlackIdentityToolkit` and `firebasePinkIdentityToolkit`.
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

  try {
    await createSystemAuditLog({
      userId: result.body.user.id,
      userName: loginUserName(result.body.user),
      userRole: result.body.roles[0] ?? result.body.agentType ?? "user",
      action: "auth.login",
      resourceType: "auth_session",
      resourceId: result.body.user.id,
      details: {
        email: result.body.user.email ?? null,
        roles: result.body.roles,
        agentType: result.body.agentType || null,
        firebaseBlackIdentityToolkit:
          result.body.firebaseBlackIdentityToolkit?.ok === true
            ? "success"
            : "failed_or_skipped",
        firebasePinkIdentityToolkit:
          result.body.firebasePinkIdentityToolkit?.ok === true
            ? "success"
            : "failed_or_skipped",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[audit] Failed to write auth.login audit log: ${msg}`);
  }

  res.json(result.body);
});

/**
 * POST /api/auth/refresh
 * Body: { refresh_token }
 *
 * Returns a new Supabase access_token (and refresh_token). Use when the JWT expires
 * before `sessionValidUntil` (~4h). The server also auto-refreshes on each protected
 * API call and may return `X-Supabase-Access-Token` on the response.
 */
router.post("/refresh", async (req, res) => {
  const body = req.body as { refresh_token?: string };
  if (!body?.refresh_token?.trim()) {
    res.status(400).json({ error: "refresh_token is required" });
    return;
  }

  const result = await refreshSupabaseAuthSession(body.refresh_token);
  if (!result.ok) {
    res.status(401).json({ error: result.message });
    return;
  }

  res.json(result.body);
});

/**
 * GET /api/auth/me
 * Authorization: Bearer <access_token from /api/auth/login>
 *
 * Includes `firebaseUid` — the BMS Firebase (Black) UID bridged via
 * `agents.firebase_black_uid` — or null when the account has no mapping.
 */
router.get("/me", attachSupabaseUser, async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(500).json({ error: "Internal error" });
    return;
  }
  const firebaseUid = await firebaseBlackUidForSupabaseUser(auth.user.id);
  res.json({ ...sessionSummaryFromLocals(auth), firebaseUid });
});

export default router;
