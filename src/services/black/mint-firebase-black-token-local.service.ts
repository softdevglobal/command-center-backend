import { createClient } from "@supabase/supabase-js";
import admin from "firebase-admin";

import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";

export type MintedBlackToken = {
  firebaseCustomToken: string;
  uid: string;
  expiresIn: number;
};

const FIREBASE_CUSTOM_TOKEN_TTL_SECONDS = 3600;

async function loadAgentClaimsForToken(userId: string): Promise<{
  agentType: string | null;
  workshopOwnerUid: string | null;
  workshopBranchId: string | null;
  workshopUserRole: string | null;
}> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  const empty = {
    agentType: null,
    workshopOwnerUid: null,
    workshopBranchId: null,
    workshopUserRole: null,
  };
  if (!url || !key) return empty;

  const supabaseAdmin = createClient(url, key);
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("bms_owner_uid, bms_branch_id, workshop_user_role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return empty;

  return {
    agentType: data.workshop_user_role ? "workshop" : "command-centre",
    workshopOwnerUid: data.bms_owner_uid ?? null,
    workshopBranchId: data.bms_branch_id ?? null,
    workshopUserRole: data.workshop_user_role ?? null,
  };
}

/**
 * Mints a Firebase **Black** custom token using credentials on this server
 * (`FIREBASE_BLACK_*` or JSON service account). Creates a Firebase Auth user by
 * email if one does not exist yet (same idea as BMS Black `firebase-token` route,
 * extended so login always yields a token when Black credentials are configured).
 */
export async function mintFirebaseBlackCustomTokenLocal(input: {
  supabaseUserId: string;
  email: string;
  roles: string[];
  displayName?: string;
}): Promise<MintedBlackToken | null> {
  const { supabaseUserId, email, roles, displayName } = input;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const app = getFirebaseBlackApp();
  if (!app) return null;

  const auth = admin.auth(app);

  let firebaseUid: string;
  try {
    const existing = await auth.getUserByEmail(normalizedEmail);
    firebaseUid = existing.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      console.warn(
        "[mintFirebaseBlackCustomTokenLocal] getUserByEmail:",
        err instanceof Error ? err.message : err
      );
      return null;
    }
    try {
      const dn = displayName?.trim();
      const created = await auth.createUser({
        email: normalizedEmail,
        emailVerified: true,
        ...(dn ? { displayName: dn } : {}),
        disabled: false,
      });
      firebaseUid = created.uid;
    } catch (createErr: unknown) {
      console.warn(
        "[mintFirebaseBlackCustomTokenLocal] createUser:",
        createErr instanceof Error ? createErr.message : createErr
      );
      return null;
    }
  }

  const claims = await loadAgentClaimsForToken(supabaseUserId);

  const customClaims: Record<string, unknown> = {
    supabaseUserId,
    roles,
    source: "command-center",
  };
  if (claims.agentType) customClaims.agentType = claims.agentType;
  if (claims.workshopOwnerUid) customClaims.workshopOwnerUid = claims.workshopOwnerUid;
  if (claims.workshopBranchId) customClaims.workshopBranchId = claims.workshopBranchId;
  if (claims.workshopUserRole) customClaims.workshopUserRole = claims.workshopUserRole;

  try {
    const firebaseCustomToken = await auth.createCustomToken(
      firebaseUid,
      customClaims
    );

    return {
      firebaseCustomToken,
      uid: firebaseUid,
      expiresIn: FIREBASE_CUSTOM_TOKEN_TTL_SECONDS,
    };
  } catch (err: unknown) {
    console.warn(
      "[mintFirebaseBlackCustomTokenLocal] createCustomToken:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
