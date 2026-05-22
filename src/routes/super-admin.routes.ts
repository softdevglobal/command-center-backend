import { Router } from "express";

import { bootstrapSuperAdminSupabase } from "../services/cc-agent/bootstrap-super-admin.service.js";

const router = Router();

/**
 * POST /api/super-admin/register
 *
 * Header: `x-setup-secret: <SETUP_SECRET_KEY>` (same value as the `SETUP_SECRET_KEY` env var).
 * Body:   `{ email, password, displayName }`
 *
 * Creates a Command Center super admin in all three identity stores:
 *   1. **Supabase** Auth user + `user_roles.role = super_admin` (Command Center login).
 *   2. **Firebase Black** Auth user + Firestore `super_admins/{uid}` (BMS Black APIs).
 *   3. **Firebase Pink**  Auth user + Firestore `super_admins/{uid}` (BMS Pink APIs).
 *
 * Firebase step is best-effort: if Admin SDK credentials are missing on Command Center the Supabase
 * record still gets created and the response includes warnings so you can fix env + retry.
 *
 * Response (201):
 * ```
 * {
 *   success: true,
 *   userId,              // Supabase auth.users.id
 *   role,                // e.g. "super_admin"
 *   firebase: {
 *     blackUid?: string,
 *     pinkUid?:  string,
 *     warnings:  string[]
 *   },
 *   message: "..."
 * }
 * ```
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

    res.status(201).json({
      success: true,
      userId: result.userId,
      role: result.role,
      firebase: {
        ...(result.firebase.blackUid ? { blackUid: result.firebase.blackUid } : {}),
        ...(result.firebase.pinkUid ? { pinkUid: result.firebase.pinkUid } : {}),
        warnings: result.firebase.warnings,
      },
      message:
        fbBlackOk && fbPinkOk
          ? "Super admin created in Supabase + Firebase Black + Firebase Pink. Sign in with POST /api/auth/login."
          : "Super admin created in Supabase. Some Firebase steps were skipped — see firebase.warnings.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bootstrap failed";
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
