/**
 * `user_roles.role` uses PostgreSQL enum `app_role`.
 * List labels: SELECT unnest(enum_range(NULL::app_role));
 */

function readConfiguredSuperAdminRole(): string | undefined {
  const direct =
    process.env.SUPABASE_SUPER_ADMIN_ROLE?.trim() ||
    process.env.APP_ROLE_SUPER_ADMIN?.trim();
  if (direct && !direct.startsWith("your_")) return direct;
  return undefined;
}

/**
 * Role inserted when bootstrapping a super admin.
 * Prefers SUPABASE_SUPER_ADMIN_ROLE or APP_ROLE_SUPER_ADMIN; otherwise **super_admin**
 * (add that label to the enum once via scripts/add-app-role-super-admin.sql).
 */
export function getSuperAdminRoleForInsert(): string {
  return readConfiguredSuperAdminRole() ?? "super_admin";
}

/** Roles that may call POST /api/agents/register. */
export function roleMayRegisterAgents(role: string): boolean {
  const configured = readConfiguredSuperAdminRole();
  if (configured && role === configured) return true;
  const legacy = new Set<string>([
    "super_admin",
    "super-admin",
    "superadmin",
    "admin",
  ]);
  return legacy.has(role);
}
