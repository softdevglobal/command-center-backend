import type { NextFunction, Request, Response } from "express";
import { createSupabaseClient } from "../db/supabase/supabase.client.js";
import type { User } from "@supabase/supabase-js";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";

export type SupabaseAuthLocals = {
  user: User;
  roles: string[];
};

function bearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const t = h.slice("Bearer ".length).trim();
  return t || null;
}

async function fetchRolesForUser(
  userId: string
): Promise<string[]> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) return [];

  const admin = createSupabaseClient(url, key);
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error || !data?.length) return [];
  return data.map((row: { role: string }) => row.role).filter(Boolean);
}

/** Verifies Supabase JWT and loads `user_roles`. Sets `res.locals.supabaseAuth`. */
export async function attachSupabaseUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({
      error:
        "Missing Authorization: Bearer <Supabase access_token> — sign in via POST /api/auth/login first.",
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
    const admin = createSupabaseClient(url, key);
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({
        error: error?.message ?? "Invalid or expired Supabase session.",
      });
      return;
    }

    const roles = await fetchRolesForUser(user.id);

    res.locals.supabaseAuth = {
      user,
      roles,
    } satisfies SupabaseAuthLocals;

    next();
  } catch {
    res.status(401).json({
      error: "Invalid or expired Supabase session.",
    });
  }
}

/** Requires `attachSupabaseUser` first. Only super_admin roles may proceed. */
export function requireSupabaseSuperAdmin(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const auth = res.locals.supabaseAuth as SupabaseAuthLocals | undefined;
  const roles = auth?.roles ?? [];
  const ok = roles.some((r) => roleMayRegisterAgents(r));
  if (!ok) {
    res.status(403).json({
      error:
        "Only super admins can register agents. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or an allowed alias (admin, super_admin, …).",
    });
    return;
  }
  next();
}
