import { createClient } from "@supabase/supabase-js";
import { Router } from "express";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";
import {
  registerAgent,
  registerAgentViaSetupSecret,
} from "../services/agent-register.service.js";
import { sessionSummaryFromLocals } from "../services/auth/supabase-auth.service.js";
import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";

const router = Router();

/**
 * POST /api/agents/register
 *
 * **Production:** `Authorization: Bearer <access_token>` from `POST /api/auth/login` as a user whose
 * `user_roles` allows agent registration (super admin / configured role).
 *
 * **Local / Postman (no login):** header `x-setup-secret: <SETUP_SECRET_KEY>` (same secret as
 * `POST /api/super-admin/register`). Uses Supabase service role on Command Center — does not call BMS Black HTTP.
 *
 * Body: name, email, phone, password, extension (required); notes?, agentType?, tenantId?,
 * workshopOwnerUid?, workshopBranchId?, workshopUserRole? for workshop agents.
 *
 * Creates Supabase agent + Firebase Black + Firebase Pink (same password) where Admin SDK is configured on CC.
 */
router.post("/register", async (req, res) => {
  const body = req.body as CreateAgentRequestBody;

  if (
    !body?.name ||
    !body?.email ||
    !body?.password ||
    body.phone === undefined
  ) {
    res.status(400).json({
      error: "name, email, phone, and password are required",
    });
    return;
  }

  const secret = req.headers["x-setup-secret"];
  const setupExpected = process.env.SETUP_SECRET_KEY?.trim();
  if (setupExpected && secret === setupExpected) {
    try {
      const result = await registerAgentViaSetupSecret(body);
      res.status(200).json({
        success: true,
        authMode: "x-setup-secret",
        supabase: {
          userId: result.userId,
          agentId: result.agentId,
        },
        firebaseBlack: { uid: result.firebaseBlackUid },
        firebasePink: { uid: result.firebasePinkUid },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      res.status(400).json({ success: false, error: msg });
    }
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const supabaseBearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!supabaseBearer) {
    res.status(401).json({
      error:
        "Missing auth: send Authorization: Bearer <Supabase access_token> from POST /api/auth/login (super admin), OR header x-setup-secret matching SETUP_SECRET_KEY for local bootstrap (same secret as POST /api/super-admin/register).",
    });
    return;
  }

  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    res.status(500).json({
      error: "Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    });
    return;
  }

  try {
    const admin = createClient(url, key);
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(supabaseBearer);

    if (userErr || !user) {
      res.status(401).json({
        error: userErr?.message ?? "Invalid or expired Supabase session.",
      });
      return;
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (roleRows ?? [])
      .map((row: { role: string }) => row.role)
      .filter(Boolean);

    if (!roles.some((r) => roleMayRegisterAgents(r))) {
      res.status(403).json({
        error:
          "Only super admins can register agents. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or super_admin / admin.",
      });
      return;
    }

    const result = await registerAgent(body, { supabaseBearer });

    res.status(200).json({
      success: true,
      authMode: "bearer",
      authenticatedAs: sessionSummaryFromLocals({ user, roles }),
      supabase: {
        userId: result.userId,
        agentId: result.agentId,
      },
      firebaseBlack: {
        uid: result.firebaseBlackUid,
      },
      firebasePink: {
        uid: result.firebasePinkUid,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Registration failed";
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
