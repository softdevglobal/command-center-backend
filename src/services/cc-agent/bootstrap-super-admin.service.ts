import { createClient } from "@supabase/supabase-js";

import { getSuperAdminRoleForInsert } from "../../config/supabase-app-role.js";
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

/**
 * Creates Supabase Auth user + `user_roles` row.
 * Role label: SUPABASE_SUPER_ADMIN_ROLE or default `super_admin` (must exist on enum `app_role`).
 */
export async function bootstrapSuperAdminSupabase(
  input: BootstrapSuperAdminBody
): Promise<{ userId: string }> {
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

  const admin = createClient(url, key);

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

  return { userId };
}
