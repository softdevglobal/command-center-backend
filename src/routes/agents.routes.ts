import { Router } from "express";

import {
  attachSupabaseUser,
  requireSupabaseSuperAdmin,
} from "../middleware/supabase-auth.middleware.js";
import { sessionSummaryFromLocals } from "../services/auth/supabase-auth.service.js";
import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";
import { registerAgent } from "../services/agent-register.service.js";

const router = Router();

/**
 * POST /api/agents/register
 * Authorization: Bearer <access_token> from POST /api/auth/login
 * Only users with `super_admin` in `user_roles` may call this.
 */
router.post(
  "/register",
  attachSupabaseUser,
  requireSupabaseSuperAdmin,
  async (req, res) => {
    const body = req.body as CreateAgentRequestBody;
    const auth = res.locals.supabaseAuth;

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

    const authHeader = req.headers.authorization ?? "";
    const supabaseBearer = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!supabaseBearer) {
      res.status(401).json({
        success: false,
        error: "Missing Authorization: Bearer <Supabase access_token>",
      });
      return;
    }

    try {
      const result = await registerAgent(body, { supabaseBearer });

      res.status(200).json({
        success: true,
        authenticatedAs: auth
          ? sessionSummaryFromLocals(auth)
          : undefined,
        supabase: {
          userId: result.userId,
          agentId: result.agentId,
        },
        firebaseBlack: {
          uid: result.firebaseBlackUid,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      res.status(400).json({ success: false, error: msg });
    }
  }
);

export default router;
