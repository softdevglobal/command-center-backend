import { Router } from "express";

import { matchesSetupSecret } from "../config/setup-secret.js";
import { bootstrapSuperAdminSupabase } from "../services/cc-agent/bootstrap-super-admin.service.js";

const router = Router();

/**
 * Super admin bootstrap — one-time platform setup.
 * Auth first; validation messages only after a valid setup secret.
 */
router.post("/register", async (req, res) => {
  if (!matchesSetupSecret(req)) {
    res.status(403).json({ error: "Forbidden" });
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
