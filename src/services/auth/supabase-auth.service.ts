import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import {
  getSupabaseAnonKeyForEdge,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import { signInFirebaseBlackWithPassword } from "./firebase-black-login.service.js";
import { rememberFirebaseBlackIdentityForUser } from "./firebase-black-login.store.js";
import { signInFirebasePinkWithPassword } from "./firebase-pink-login.service.js";
import { rememberFirebasePinkIdentityForUser } from "./firebase-pink-login.store.js";

export type LoginInput = {
  email: string;
  password: string;
};

/** Login JSON status for Black/Pink Identity Toolkit (idTokens stored server-side, not in response). */
export type FirebaseIdentityToolkitLogin =
  | {
      ok: true;
      /** Firebase idToken saved in memory — `firebase-black-login.store` or `firebase-pink-login.store`. */
      stored: true;
      localId?: string | undefined;
      email?: string | undefined;
      displayName?: string | undefined;
      registered?: boolean | undefined;
    }
  | { ok: false; error: string };

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
  /**
   * Black Firebase sign-in status. On success, idToken is stored server-side only
   * (`firebase-black-login.store.ts`) — not returned in this JSON.
   */
  firebaseBlackIdentityToolkit?: FirebaseIdentityToolkitLogin;
  /**
   * Pink Firebase sign-in status. On success, idToken is stored server-side only
   * (`firebase-pink-login.store.ts`) — not returned in this JSON.
   */
  firebasePinkIdentityToolkit?: FirebaseIdentityToolkitLogin;
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

  const admin = createSupabaseClient(url, key);
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error || !data?.length) return [];
  return data.map((row: { role: string }) => row.role).filter(Boolean);
}

/** Visible summary in the server terminal after each successful HTTP login. */
function logBmsLoginTerminalBanner(lines: readonly string[]): void {
  const bar =
    "===========================================================";
  console.log("");
  console.log(bar);
  console.log("  [BMS LOGIN]  POST /api/auth/login  (automatic pipeline)");
  console.log(bar);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log(bar);
  console.log("");
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

  const supabase = createSupabaseClient(url, anon);
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

  const firebaseWebApiKey = (
    process.env.FIREBASE_BLACK_WEB_API_KEY ?? ""
  ).trim();
  if (firebaseWebApiKey) {
    const fbPass = await signInFirebaseBlackWithPassword({
      email: input.email.trim(),
      password: input.password,
      webApiKey: firebaseWebApiKey,
    });
    if (fbPass.ok) {
      const idToken = fbPass.data.idToken;
      if (idToken) {
        const d = fbPass.data;
        rememberFirebaseBlackIdentityForUser({
          supabaseUserId: data.user.id,
          idToken,
          refreshToken: d.refreshToken,
          expiresIn: d.expiresIn,
          email: d.email ?? input.email.trim(),
        });
        // Firebase Black idToken stored server-side (firebase-black-login.store.ts).
        // idToken / refreshToken are not returned in login JSON — see commented block below.
        // body.firebaseBlackIdentityToolkit = {
        //   ok: true,
        //   kind: d.kind,
        //   localId: d.localId,
        //   email: d.email,
        //   displayName: d.displayName,
        //   idToken,
        //   refreshToken: d.refreshToken,
        //   expiresIn: d.expiresIn,
        //   registered: d.registered,
        // };
        body.firebaseBlackIdentityToolkit = {
          ok: true,
          stored: true,
          localId: d.localId,
          email: d.email,
          displayName: d.displayName,
          registered: d.registered,
        };
      } else {
        body.firebaseBlackIdentityToolkit = {
          ok: false,
          error: "Missing idToken in Identity Toolkit response.",
        };
      }
    } else {
      body.firebaseBlackIdentityToolkit = { ok: false, error: fbPass.message };
    }
  } else {
    body.firebaseBlackIdentityToolkit = {
      ok: false,
      error:
        "SKIPPED — set FIREBASE_BLACK_WEB_API_KEY on the Command Center server (.env), then restart. Use the Web API key from Firebase Console → Project settings (Black/bmspro-black project).",
    };
  }

  const firebasePinkWebApiKey = (
    process.env.FIREBASE_PINK_WEB_API_KEY ?? ""
  ).trim();
  if (firebasePinkWebApiKey) {
    const pinkPass = await signInFirebasePinkWithPassword({
      email: input.email.trim(),
      password: input.password,
      webApiKey: firebasePinkWebApiKey,
    });
    if (pinkPass.ok) {
      const idTokenPink = pinkPass.data.idToken;
      if (idTokenPink) {
        const pd = pinkPass.data;
        rememberFirebasePinkIdentityForUser({
          supabaseUserId: data.user.id,
          idToken: idTokenPink,
          refreshToken: pd.refreshToken,
          expiresIn: pd.expiresIn,
          email: pd.email ?? input.email.trim(),
        });
        // Firebase Pink idToken stored server-side (firebase-pink-login.store.ts).
        // idToken / refreshToken are not returned in login JSON — see commented block below.
        // body.firebasePinkIdentityToolkit = {
        //   ok: true,
        //   kind: pd.kind,
        //   localId: pd.localId,
        //   email: pd.email,
        //   displayName: pd.displayName,
        //   idToken: idTokenPink,
        //   refreshToken: pd.refreshToken,
        //   expiresIn: pd.expiresIn,
        //   registered: pd.registered,
        // };
        body.firebasePinkIdentityToolkit = {
          ok: true,
          stored: true,
          localId: pd.localId,
          email: pd.email,
          displayName: pd.displayName,
          registered: pd.registered,
        };
      } else {
        body.firebasePinkIdentityToolkit = {
          ok: false,
          error: "Missing idToken in Identity Toolkit response.",
        };
      }
    } else {
      body.firebasePinkIdentityToolkit = {
        ok: false,
        error: pinkPass.message,
      };
    }
  } else {
    body.firebasePinkIdentityToolkit = {
      ok: false,
      error:
        "SKIPPED — set FIREBASE_PINK_WEB_API_KEY on the Command Center server (.env), then restart. Use the Web API key from Firebase Console → Project settings (Pink/bmspro-pink project).",
    };
  }

  const loginEmailLabel =
    data.user.email ?? userOut.email ?? input.email.trim();
  const bannerLines: string[] = [
    "1) Supabase Auth: SUCCESS",
    `    user id: ${data.user.id}`,
    `    email:   ${loginEmailLabel}`,
    "2) Google Identity Toolkit (accounts:signInWithPassword, bmspro-black):",
  ];
  if (!firebaseWebApiKey) {
    bannerLines.push(
      "    SKIPPED — FIREBASE_BLACK_WEB_API_KEY is empty.",
      "    -> Add the Web API key to .env and restart the server to auto-call Identity Toolkit."
    );
  } else if (body.firebaseBlackIdentityToolkit?.ok === true) {
    const d = body.firebaseBlackIdentityToolkit;
    bannerLines.push(
      "    SUCCESS — same email/password accepted by Firebase.",
      `    localId: ${d.localId ?? "n/a"}   registered: ${String(d.registered)}   idToken: stored server-side (firebase-black-login.store)`
    );
  } else if (body.firebaseBlackIdentityToolkit && body.firebaseBlackIdentityToolkit.ok === false) {
    bannerLines.push(
      "    FAILED — Firebase did not return a usable session for this password.",
      `    -> ${body.firebaseBlackIdentityToolkit.error}`
    );
  } else {
    bannerLines.push("    (unexpected — no toolkit result)");
  }

  bannerLines.push(
    "3) Google Identity Toolkit (accounts:signInWithPassword, bmspro-pink):"
  );
  if (!firebasePinkWebApiKey) {
    bannerLines.push(
      "    SKIPPED — FIREBASE_PINK_WEB_API_KEY is empty.",
      "    -> Add the Pink Web API key to .env (Firebase console → Project settings → Web API key)."
    );
  } else if (body.firebasePinkIdentityToolkit?.ok === true) {
    const p = body.firebasePinkIdentityToolkit;
    bannerLines.push(
      "    SUCCESS — same email/password accepted by Firebase Pink.",
      `    localId: ${p.localId ?? "n/a"}   registered: ${String(p.registered)}   idToken: stored server-side (firebase-pink-login.store)`
    );
  } else if (
    body.firebasePinkIdentityToolkit &&
    body.firebasePinkIdentityToolkit.ok === false
  ) {
    bannerLines.push(
      "    FAILED — Firebase Pink did not return a usable session for this password.",
      `    -> ${body.firebasePinkIdentityToolkit.error}`
    );
  } else {
    bannerLines.push("    (unexpected — no Pink toolkit result)");
  }
  logBmsLoginTerminalBanner(bannerLines);

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
