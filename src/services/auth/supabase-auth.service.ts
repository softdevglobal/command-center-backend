import { createClient } from "@supabase/supabase-js";

import {
  getSupabaseAnonKeyForEdge,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import { fetchFirebaseBlackTokenForSupabaseUser } from "../black/firebase-token-from-black.service.js";
import { mintFirebaseBlackCustomTokenLocal } from "../black/mint-firebase-black-token-local.service.js";

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginSuccess = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  roles: string[];
  agentType: string;
  /** Firebase Black — `agenttoken` is the custom JWT for `signInWithCustomToken`. */
  firebaseBlack?: {
    agenttoken: string;
    uid: string;
    expiresIn: number;
  };
};

function displayNameFromUser(meta: Record<string, unknown> | undefined): string {
  const dn = meta?.display_name;
  return typeof dn === "string" ? dn : "";
}

function agentTypeFromUser(meta: Record<string, unknown> | undefined): string {
  const at = meta?.agent_type;
  return typeof at === "string" ? at : "";
}

async function fetchRoles(userId: string): Promise<string[]> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) return [];

  const admin = createClient(url, key);
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error || !data?.length) return [];
  return data.map((row: { role: string }) => row.role).filter(Boolean);
}

/** Email/password against Supabase Auth; returns session tokens + roles from `user_roles`. */
export async function loginWithSupabasePassword(
  input: LoginInput
): Promise<
  | { ok: true; body: LoginSuccess }
  | { ok: false; message: string; networkError?: boolean }
> {
  const url = getSupabaseProjectUrl();
  const anon = getSupabaseAnonKeyForEdge();

  if (!url || !anon) {
    return {
      ok: false,
      message:
        "Missing SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_SUPABASE_* publishable key) for login.",
    };
  }

  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });

  if (error || !data.session || !data.user) {
    const raw = error?.message ?? "Login failed.";
    const networkLike =
      /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|network|Name resolution/i.test(
        raw
      );
    return {
      ok: false,
      message: networkLike
        ? `${raw} — cannot reach Supabase (check internet / DNS / VPN). Login does not use JWT_SECRET.`
        : raw,
      networkError: networkLike,
    };
  }

  const meta = data.user.user_metadata as Record<string, unknown> | undefined;
  const roles = await fetchRoles(data.user.id);

  const userOut: LoginSuccess["user"] = { id: data.user.id };
  if (data.user.email !== undefined && data.user.email !== null) {
    userOut.email = data.user.email;
  }
  if (meta !== undefined) {
    userOut.user_metadata = meta;
  }

  const body: LoginSuccess = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: userOut,
    roles,
    agentType: agentTypeFromUser(meta),
  };
  if (data.session.expires_at !== undefined) {
    body.expires_at = data.session.expires_at;
  }

  const emailForFirebase =
    data.user.email ?? userOut.email ?? input.email.trim();

  const fbToken =
    (await mintFirebaseBlackCustomTokenLocal({
      supabaseUserId: data.user.id,
      email: emailForFirebase,
      roles,
      displayName: displayNameFromUser(meta),
    })) ??
    (await fetchFirebaseBlackTokenForSupabaseUser({
      supabaseBearer: data.session.access_token,
    }));
  if (fbToken) {
    body.firebaseBlack = {
      agenttoken: fbToken.firebaseCustomToken,
      uid: fbToken.uid,
      expiresIn: fbToken.expiresIn,
    };
  }

  return { ok: true, body };
}

/** Shape for GET /me — same fields clients expect from login profile. */
export function sessionSummaryFromLocals(input: {
  user: import("@supabase/supabase-js").User;
  roles: string[];
}) {
  const meta = input.user.user_metadata as Record<string, unknown> | undefined;
  return {
    uid: input.user.id,
    email: input.user.email ?? "",
    displayName: displayNameFromUser(meta),
    roles: input.roles,
    role: input.roles[0] ?? "",
    agentType: agentTypeFromUser(meta),
  };
}
