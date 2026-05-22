import type { User } from "@supabase/supabase-js";
import { createSupabaseClient } from "../db/supabase/supabase.client.js";
import type { NextFunction, Request, Response } from "express";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";

export type SuperAdminOrSetupAuth =
  | { kind: "setup-secret" }
  | { kind: "bearer"; user: User; roles: string[] };

/**
 * Same contract as agent registration / DID mappings:
 * `x-setup-secret` when SETUP_SECRET_KEY is set, or super-admin Bearer JWT.
 */
export async function authorizeSuperAdminOrSetup(
  req: Request,
  res: Response,
  options?: { forbiddenMessage?: string }
): Promise<SuperAdminOrSetupAuth | null> {
  const secret = req.headers["x-setup-secret"];
  const setupExpected = process.env.SETUP_SECRET_KEY?.trim();
  if (setupExpected && secret === setupExpected) {
    return { kind: "setup-secret" };
  }

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    res.status(401).json({
      error:
        "Missing auth: send Authorization: Bearer <Supabase access_token> from POST /api/auth/login (super admin), OR header x-setup-secret matching SETUP_SECRET_KEY.",
    });
    return null;
  }

  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    res.status(500).json({
      error: "Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    });
    return null;
  }

  try {
    const admin = createSupabaseClient(url, key);
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(token);

    if (userErr || !user) {
      res.status(401).json({
        error: userErr?.message ?? "Invalid or expired Supabase session.",
      });
      return null;
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
          options?.forbiddenMessage ??
          "Only super admins may access this resource. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or super_admin / admin.",
      });
      return null;
    }

    return { kind: "bearer", user, roles };
  } catch {
    res.status(401).json({ error: "Invalid or expired Supabase session." });
    return null;
  }
}

/** Attaches `res.locals.superAdminAuth` when authorized. */
export async function requireSuperAdminOrSetup(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const auth = await authorizeSuperAdminOrSetup(req, res);
  if (!auth) return;
  res.locals.superAdminAuth = auth;
  next();
}
