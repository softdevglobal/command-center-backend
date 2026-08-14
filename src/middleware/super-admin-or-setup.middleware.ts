import type { User } from "@supabase/supabase-js";
import { createSupabaseClient } from "../db/supabase/supabase.client.js";
import type { NextFunction, Request, Response } from "express";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import { matchesSetupSecret } from "../config/setup-secret.js";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";

export type SuperAdminOrSetupAuth =
  | { kind: "setup-secret" }
  | { kind: "bearer"; user: User; roles: string[] };

/**
 * Setup-secret bootstrap (when enabled) or super-admin Bearer JWT.
 * Public error bodies stay generic — no secret header or env var names.
 */
export async function authorizeSuperAdminOrSetup(
  req: Request,
  res: Response,
  options?: { forbiddenMessage?: string }
): Promise<SuperAdminOrSetupAuth | null> {
  if (matchesSetupSecret(req)) {
    return { kind: "setup-secret" };
  }

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    res.status(500).json({
      error: "Supabase is not configured.",
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
      res.status(401).json({ error: "Unauthorized" });
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
        error: options?.forbiddenMessage ?? "Forbidden",
      });
      return null;
    }

    return { kind: "bearer", user, roles };
  } catch {
    res.status(401).json({ error: "Unauthorized" });
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
