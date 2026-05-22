import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import type {
  CreateSystemAuditLogInput,
  SystemAuditLogListFilters,
  SystemAuditLogListResult,
  SystemAuditLogRow,
} from "../../types/system-audit-log.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createSupabaseClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: SystemAuditLogListFilters): {
  limit: number;
  offset: number;
} {
  const limitRaw = filters.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT)
  );
  const offsetRaw = filters.offset ?? 0;
  const offset = Math.max(
    0,
    Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0
  );
  return { limit, offset };
}

export async function createSystemAuditLogInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  body: CreateSystemAuditLogInput;
}): Promise<SystemAuditLogRow> {
  const body = input.body;
  const userId = String(body.userId ?? "").trim();
  const userName = String(body.userName ?? "").trim();
  const userRole = String(body.userRole ?? "").trim();
  const action = String(body.action ?? "").trim();
  const resourceType = String(body.resourceType ?? "").trim();

  if (!userId || !userName || !userRole || !action || !resourceType) {
    throw new Error(
      "userId, userName, userRole, action, and resourceType are required."
    );
  }

  const details =
    body.details && typeof body.details === "object" && !Array.isArray(body.details)
      ? body.details
      : {};

  const row = {
    user_id: userId,
    user_name: userName,
    user_role: userRole,
    action,
    resource_type: resourceType,
    resource_id:
      body.resourceId === undefined || body.resourceId === null
        ? null
        : String(body.resourceId),
    details,
  };

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("system_audit_logs")
    .insert(row)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as SystemAuditLogRow;
}

export async function listSystemAuditLogsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: SystemAuditLogListFilters;
}): Promise<SystemAuditLogListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("system_audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  const userId = input.filters.userId?.trim();
  const action = input.filters.action?.trim();
  const resourceType = input.filters.resourceType?.trim();
  const resourceId = input.filters.resourceId?.trim();
  const from = input.filters.from?.trim();
  const to = input.filters.to?.trim();

  if (userId) q = q.eq("user_id", userId);
  if (action) q = q.eq("action", action);
  if (resourceType) q = q.eq("resource_type", resourceType);
  if (resourceId) q = q.eq("resource_id", resourceId);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, error, count } = await q.range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as SystemAuditLogRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getSystemAuditLogByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<SystemAuditLogRow | null> {
  const key = input.id.trim();
  if (!key) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("system_audit_logs")
    .select("*")
    .eq("id", key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SystemAuditLogRow | null) ?? null;
}
