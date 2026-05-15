import { blackEndpoint } from "../../config/black-api.js";
import type {
  CreateAgentRequestBody,
  RegisterAgentResult,
} from "../../types/agent-registration.types.js";

export type RegisterAgentViaBlackResult = RegisterAgentResult & {
  firebaseBlackUid: string;
};

/**
 * Calls BMS Black `POST /api/call-center/supabase/register-agent`, forwarding the
 * super-admin's Supabase Bearer. Black creates the Supabase Auth user, `user_roles`
 * row, `agents` row, AND the Firebase Black Auth user in a single transaction.
 */
export async function registerAgentViaBlack(input: {
  body: CreateAgentRequestBody;
  supabaseBearer: string;
}): Promise<RegisterAgentViaBlackResult> {
  const { body, supabaseBearer } = input;

  const url = blackEndpoint("/api/call-center/supabase/register-agent");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseBearer}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown network error";
    throw new Error(`Could not reach BMS Black register-agent endpoint: ${msg}`);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* body may be empty / non-JSON on some errors */
  }

  if (!res.ok) {
    const errMsg =
      (payload as { error?: string } | null)?.error ??
      `BMS Black register-agent failed (HTTP ${res.status})`;
    throw new Error(errMsg);
  }

  const ok = payload as {
    supabase?: { userId?: string; agentId?: string };
    firebaseBlack?: { uid?: string };
  } | null;

  const userId = ok?.supabase?.userId;
  const agentId = ok?.supabase?.agentId;
  const firebaseBlackUid = ok?.firebaseBlack?.uid;

  if (!userId || !agentId || !firebaseBlackUid) {
    throw new Error(
      "BMS Black response missing required ids (supabase.userId / supabase.agentId / firebaseBlack.uid)."
    );
  }

  return { userId, agentId, firebaseBlackUid };
}
