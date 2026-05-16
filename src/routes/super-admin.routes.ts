import { Router } from "express";

import { bootstrapSuperAdminSupabase } from "../services/cc-agent/bootstrap-super-admin.service.js";

const router = Router();

/**
 * POST /api/super-admin/register
 * One-time bootstrap. Header: x-setup-secret: <SETUP_SECRET_KEY>
 * Body: { email, password, displayName }
 *
 * Creates Supabase Auth user + user_roles.super_admin. Does not store agents in Firebase.
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

  try {
    const { userId } = await bootstrapSuperAdminSupabase({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });
    res.status(201).json({
      success: true,
      userId,
      message:
        "Super admin created. Sign in with POST /api/auth/login, then use Bearer access_token on POST /api/agents/register (or x-setup-secret for local bootstrap).",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bootstrap failed";
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
