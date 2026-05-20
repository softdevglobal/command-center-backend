import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AgentLeaveDurationType,
  AgentLeaveHalfDayPart,
  AgentLeaveRequestCreateInput,
  AgentLeaveRequestListFilters,
  AgentLeaveRequestListResult,
  AgentLeaveRequestReviewInput,
  AgentLeaveRequestRow,
  AgentLeaveRequestStatus,
} from "../../types/agent-leave-request.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const DURATION_TYPES: AgentLeaveDurationType[] = ["full_day", "half_day"];
const HALF_DAY_PARTS: AgentLeaveHalfDayPart[] = ["am", "pm"];
const REQUEST_STATUSES: AgentLeaveRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
];

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: AgentLeaveRequestListFilters): {
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

export function isAgentLeaveDurationType(
  value: string
): value is AgentLeaveDurationType {
  return (DURATION_TYPES as string[]).includes(value);
}

export function isAgentLeaveHalfDayPart(
  value: string
): value is AgentLeaveHalfDayPart {
  return (HALF_DAY_PARTS as string[]).includes(value);
}

export function isAgentLeaveRequestStatus(
  value: string
): value is AgentLeaveRequestStatus {
  return (REQUEST_STATUSES as string[]).includes(value);
}

export async function listAgentLeaveRequestsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: AgentLeaveRequestListFilters;
}): Promise<AgentLeaveRequestListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("agent_leave_requests")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  const scopeUserId = input.filters.scopeUserId?.trim();
  const userId = input.filters.userId?.trim();
  const tenantId = input.filters.tenantId?.trim();
  const status = input.filters.status;
  const from = input.filters.from?.trim();
  const to = input.filters.to?.trim();

  if (scopeUserId) q = q.eq("user_id", scopeUserId);
  else if (userId) q = q.eq("user_id", userId);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (status) q = q.eq("status", status);
  if (from) q = q.gte("end_date", from);
  if (to) q = q.lte("start_date", to);

  const { data, error, count } = await q.range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as AgentLeaveRequestRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getAgentLeaveRequestByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<AgentLeaveRequestRow | null> {
  const key = input.id.trim();
  if (!key) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_leave_requests")
    .select("*")
    .eq("id", key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentLeaveRequestRow | null) ?? null;
}

export async function createAgentLeaveRequestInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  row: AgentLeaveRequestCreateInput;
}): Promise<AgentLeaveRequestRow> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  const insertRow: Record<string, unknown> = {
    user_id: input.row.userId.trim(),
    tenant_id: input.row.tenantId ?? null,
    agent_display_name: input.row.agentDisplayName?.trim() || null,
    start_date: input.row.startDate,
    end_date: input.row.endDate,
    duration_type: input.row.durationType,
    half_day_part: input.row.halfDayPart ?? null,
    reason: input.row.reason?.trim() || null,
    attachment_storage_path: input.row.attachmentStoragePath?.trim() || null,
  };

  const { data, error } = await supabase
    .from("agent_leave_requests")
    .insert(insertRow)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AgentLeaveRequestRow;
}

export async function reviewAgentLeaveRequestInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
  review: AgentLeaveRequestReviewInput;
}): Promise<AgentLeaveRequestRow | null> {
  const key = input.id.trim();
  if (!key) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agent_leave_requests")
    .update({
      status: input.review.status,
      reviewed_by: input.review.reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_comment: input.review.reviewComment?.trim() || null,
    })
    .eq("id", key)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentLeaveRequestRow | null) ?? null;
}
