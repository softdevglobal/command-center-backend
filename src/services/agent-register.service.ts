import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";
import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";
import { registerCommandCenterAgentInSupabase } from "./auth/register-command-center-agent-supabase.service.js";
import { ensureFirebasePinkAuthUser } from "./auth/ensure-firebase-pink-auth-user.service.js";
import { syncCallCenterAgentToBlackPinkFirestore } from "./sync-call-center-agent-firestore.service.js";

/** Same shape as the former Black HTTP delegate response. */
export type RegisterAgentCompleteResult = {
  agentId: string;
  userId: string;
  firebaseBlackUid: string;
  firebasePinkUid: string;
};

/**
 * Supabase Auth + `agents` + Firebase Black/Pink Auth + `call_center_agents/{uid}` on both projects.
 * Super-admin Bearer (or setup-secret on the route) is validated **before** this runs.
 */
export async function registerAgentOnCommandCenter(
  body: CreateAgentRequestBody
): Promise<RegisterAgentCompleteResult> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for agent registration."
    );
  }

  const blackResult = await registerCommandCenterAgentInSupabase({
    supabaseUrl: url,
    serviceRoleKey: key,
    body,
  });

  let firebasePinkUid: string;
  try {
    firebasePinkUid = await ensureFirebasePinkAuthUser({
      email: body.email,
      password: body.password,
      displayName: body.name,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Agent was created in Supabase and Firebase Black, but Firebase Pink failed (${msg}). You may need to fix Pink config or remove the partial agent rows and retry.`
    );
  }

  try {
    await syncCallCenterAgentToBlackPinkFirestore({
      body,
      firebaseBlackUid: blackResult.firebaseBlackUid,
      firebasePinkUid,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Agent Auth users exist, but Firestore call_center_agents sync failed (${msg}). Fix Firebase/Firestore config or retry after cleanup.`
    );
  }

  return { ...blackResult, firebasePinkUid };
}

/** Alias — Postman / bootstrap header `x-setup-secret`. */
export async function registerAgentViaSetupSecret(
  body: CreateAgentRequestBody
): Promise<RegisterAgentCompleteResult> {
  return registerAgentOnCommandCenter(body);
}

/**
 * Bearer path — caller super-admin JWT is verified in `agents.routes.ts`.
 * Registration no longer calls BMS Black HTTP (avoids 404 when Black omits `/api/call-center/supabase/register-agent`).
 */
export async function registerAgent(
  body: CreateAgentRequestBody,
  _options: { supabaseBearer: string }
): Promise<RegisterAgentCompleteResult> {
  void _options;
  return registerAgentOnCommandCenter(body);
}
