import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import { getSuperAdminRoleForInsert } from "../../config/supabase-app-role.js";
import {
  provisionCallCenterLeadFirebaseIdentities,
  type ProvisionLeadFirebaseResult,
} from "../auth/provision-call-center-lead-firebase.service.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";

export type BootstrapSuperAdminBody = {
  email: string;
  password: string;
  displayName: string;
};

export type BootstrapSuperAdminResult = {
  userId: string;
  role: string;
  firebase: ProvisionLeadFirebaseResult;
};

/**
 * Creates a Command Center super admin in **three** places:
 *   1. Supabase Auth user + `user_roles.role = super_admin` (so Command Center login works).
 *   2. Firebase **Black** Auth + Firestore `super_admins/{uid}` (so BMS Black call-center APIs accept the token).
 *   3. Firebase **Pink**  Auth + Firestore `super_admins/{uid}` (so BMS Pink call-center APIs accept the token).
 *
 * Firebase step is best-effort: if Admin SDK credentials are missing on Command Center, Supabase still
 * succeeds and the response surfaces a warning so the caller can fix env + retry.
 * Role label: SUPABASE_SUPER_ADMIN_ROLE or default `super_admin` (must exist on enum `app_role`).
 */
export async function bootstrapSuperAdminSupabase(
  input: BootstrapSuperAdminBody
): Promise<BootstrapSuperAdminResult> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();

  if (!url || !key) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new Error(
      missing.length > 0
        ? `Missing Supabase env: ${missing.join(", ")}`
        : "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    );
  }

  const roleValue = getSuperAdminRoleForInsert();

  const admin = createSupabaseClient(url, key);

  const { data: newUser, error: userErr } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      display_name: input.displayName.trim(),
      agent_type: "command-centre",
    },
  });

  if (userErr || !newUser.user) {
    throw new Error(userErr?.message ?? "Failed to create auth user.");
  }

  const userId = newUser.user.id;

  const { error: roleErr } = await admin.from("user_roles").insert({
    user_id: userId,
    role: roleValue,
  });

  if (roleErr) {
    throw new Error(
      `Failed to assign role (${roleValue}): ${roleErr.message}. ` +
        `SUPABASE_SUPER_ADMIN_ROLE must match enum app_role exactly. ` +
        `List labels: SELECT unnest(enum_range(NULL::app_role)); — or run scripts/add-app-role-super-admin.sql`
    );
  }

  // Mirror into BMS Firebase (Auth + super_admins) so call-center proxies & BMS Firebase-backed
  // routes accept this user's idToken — same shape as BMS Black/Pink `super_admins/{uid}` docs.
  let firebase: ProvisionLeadFirebaseResult;
  try {
    firebase = await provisionCallCenterLeadFirebaseIdentities({
      email: input.email,
      password: input.password,
      displayName: input.displayName.trim(),
    });
    if (firebase.warnings.length > 0) {
      console.warn(
        `[bootstrap super-admin] Firebase provisioning warnings: ${firebase.warnings.join(" | ")}`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      "[bootstrap super-admin] Firebase provisioning crashed (Supabase user still created):",
      msg
    );
    firebase = { warnings: [`Firebase provisioning crashed: ${msg}`] };
  }

  return { userId, role: roleValue, firebase };
}
