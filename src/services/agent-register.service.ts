import {
  createSupabaseClient,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";
import type { CreateAgentRequestBody } from "../types/agent-registration.types.js";
import { ensureFirebaseBlueAuthUser } from "./auth/ensure-firebase-blue-auth-user.service.js";
import { ensureFirebasePinkAuthUser } from "./auth/ensure-firebase-pink-auth-user.service.js";
import { registerCommandCenterAgentInSupabase } from "./auth/register-command-center-agent-supabase.service.js";
import { syncCallCenterAgentToBlackPinkBlueFirestore } from "./sync-call-center-agent-firestore.service.js";

/** Same shape as the former Black HTTP delegate response. */
export type RegisterAgentCompleteResult = {
  agentId: string;
  userId: string;
  firebaseBlackUid: string;
  firebasePinkUid: string;
  firebaseBlueUid: string;
};

async function persistFirebaseUidsOnAgentRow(input: {
  agentId: string;
  firebasePinkUid: string;
  firebaseBlueUid: string;
}): Promise<void> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) return;

  const supabaseAdmin = createSupabaseClient(url, key);
  const { error } = await supabaseAdmin
    .from("agents")
    .update({
      firebase_pink_uid: input.firebasePinkUid,
      firebase_blue_uid: input.firebaseBlueUid,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.agentId);

  if (error) {
    console.warn(
      `[agent-register] Optional agents.firebase_pink_uid / firebase_blue_uid update skipped: ${error.message}`
    );
  }
}

/**
 * Full agent registration pipeline (invoked from `POST /api/agents/register`).
 *
 * Order of operations:
 *   1. `registerCommandCenterAgentInSupabase` — Supabase Auth, `user_roles` (agent), `agents` row, Firebase Black Auth
 *   2. `ensureFirebasePinkAuthUser` — Pink Auth (bmspro-pink)
 *   3. `ensureFirebaseBlueAuthUser` — Blue Auth (bmspro-trade)
 *   4. `syncCallCenterAgentToBlackPinkBlueFirestore` — Firestore `call_center_agents/{uid}` on all three
 *   5. Best-effort update `agents.firebase_pink_uid` / `agents.firebase_blue_uid` in Supabase
 *
 * Super-admin Bearer or `x-setup-secret` is validated in `agents.routes.ts` before this runs.
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

  let firebaseBlueUid: string;
  try {
    firebaseBlueUid = await ensureFirebaseBlueAuthUser({
      email: body.email,
      password: body.password,
      displayName: body.name,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Agent was created in Supabase, Firebase Black, and Firebase Pink, but Firebase Blue failed (${msg}). You may need to fix Blue config or remove the partial agent rows and retry.`
    );
  }

  try {
    await syncCallCenterAgentToBlackPinkBlueFirestore({
      body,
      supabaseUserId: blackResult.userId,
      firebaseBlackUid: blackResult.firebaseBlackUid,
      firebasePinkUid,
      firebaseBlueUid,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Agent Auth users exist, but Firestore call_center_agents sync failed (${msg}). Fix Firebase/Firestore config or retry after cleanup.`
    );
  }

  await persistFirebaseUidsOnAgentRow({
    agentId: blackResult.agentId,
    firebasePinkUid,
    firebaseBlueUid,
  });

  return { ...blackResult, firebasePinkUid, firebaseBlueUid };
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
