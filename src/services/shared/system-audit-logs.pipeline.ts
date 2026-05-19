import type {
  SystemAuditLogListFilters,
  SystemAuditLogListResult,
  SystemAuditLogRow,
} from "../../types/system-audit-log.types.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import {
  getSystemAuditLogByIdInSupabase,
  listSystemAuditLogsInSupabase,
} from "./supabase-system-audit-logs.service.js";

function assertSupabaseForAuditLogs(): {
  supabaseUrl: string;
  serviceRoleKey: string;
} {
  const supabaseUrl = getSupabaseProjectUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new Error(
      missing.length > 0
        ? `Missing or unset Supabase env: ${missing.join(", ")}. Ensure project-root .env exists and restart the server.`
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for system audit log APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.system_audit_logs`. */
export async function listSystemAuditLogsViaSupabase(input: {
  filters: SystemAuditLogListFilters;
}): Promise<SystemAuditLogListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAuditLogs();
  return listSystemAuditLogsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getSystemAuditLogByIdViaSupabase(input: {
  id: string;
}): Promise<SystemAuditLogRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForAuditLogs();
  return getSystemAuditLogByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}
