import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentDeleteResult,
  AgentListFilters,
  AgentListResult,
  AgentPerformanceFilters,
  AgentPerformanceResult,
  AgentPerformanceRow,
  AgentRow,
  AgentUpdateInput,
} from "../../types/agent-management.types.js";
import type { CallRow } from "../../types/call.types.js";

const AGENT_SELECT =
  "id, tenant_id, queue_ids, name, extension, role, status, current_caller, call_start_time, created_at, updated_at, email, notes, phone_number, group_ids, user_id, bms_owner_uid, bms_branch_id, workshop_user_role, allowed_queue_ids";
const DEFAULT_AGENT_LIMIT = 100;
const MAX_AGENT_LIMIT = 500;
const CALLS_PAGE_SIZE = 1000;
const ALLOWED_WORKSHOP_ROLES = ["owner", "branch_admin", "staff"] as const;

type WorkshopRole = (typeof ALLOWED_WORKSHOP_ROLES)[number];

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

/** Resolves `agents.id` for a Supabase Auth user (`agents.user_id`). */
export async function getAgentIdByUserIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
}): Promise<string | null> {
  const profile = await getAgentProfileByUserIdInSupabase(input);
  return profile?.id ?? null;
}

/** Agent row fields used when recording attendance. */
export async function getAgentProfileByUserIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
}): Promise<{
  id: string;
  name: string;
  tenant_id: string | null;
} | null> {
  const userId = input.userId.trim();
  if (!userId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, tenant_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const row = data as {
    id?: string;
    name?: string;
    tenant_id?: string | null;
  } | null;
  const id = row?.id?.trim();
  if (!id) return null;
  return {
    id,
    name: typeof row?.name === "string" ? row.name : "",
    tenant_id:
      typeof row?.tenant_id === "string" && row.tenant_id.trim() !== ""
        ? row.tenant_id
        : null,
  };
}

/** Resolves Supabase Auth `user_id` from `agents.id` (e.g. agent-1777874280295). */
export async function getAgentUserIdByAgentIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
}): Promise<string | null> {
  const agentId = input.agentId.trim();
  if (!agentId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select("user_id")
    .eq("id", agentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const userId = (data as { user_id?: string } | null)?.user_id;
  return typeof userId === "string" && userId.trim() !== "" ? userId : null;
}

export type AgentProfileRow = {
  id: string;
  user_id: string;
  name: string;
  tenant_id: string | null;
};

/** Agent profiles for report labels (`agents.id`, display name). */
export async function listAgentProfilesInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userIds?: string[];
}): Promise<AgentProfileRow[]> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  let q = supabase
    .from("agents")
    .select("id, user_id, name, tenant_id")
    .not("user_id", "is", null);

  const userIds = input.userIds?.map((id) => id.trim()).filter(Boolean);
  if (userIds?.length) {
    q = q.in("user_id", userIds);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const r = row as {
        id?: string;
        user_id?: string;
        name?: string;
        tenant_id?: string | null;
      };
      const id = r.id?.trim();
      const userId = r.user_id?.trim();
      if (!id || !userId) return null;
      return {
        id,
        user_id: userId,
        name: typeof r.name === "string" ? r.name : "",
        tenant_id:
          typeof r.tenant_id === "string" && r.tenant_id.trim() !== ""
            ? r.tenant_id
            : null,
      } satisfies AgentProfileRow;
    })
    .filter((row): row is AgentProfileRow => row != null);
}

function errorWithStatus(message: string, statusCode: number): Error {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function normalizeAgentPagination(filters: AgentListFilters): {
  limit: number;
  offset: number;
} {
  const rawLimit = filters.limit ?? DEFAULT_AGENT_LIMIT;
  const limit = Math.min(
    MAX_AGENT_LIMIT,
    Math.max(
      1,
      Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_AGENT_LIMIT
    )
  );
  const rawOffset = filters.offset ?? 0;
  const offset = Math.max(
    0,
    Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0
  );
  return { limit, offset };
}

function hasOwn(input: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function trimmedText(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const text = trimmedText(value);
  return text ? text : null;
}

function requiredTrimmedText(value: unknown, fieldName: string): string {
  const text = trimmedText(value);
  if (!text) throw errorWithStatus(`${fieldName} cannot be empty.`, 400);
  return text;
}

function normalizeTextArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw errorWithStatus(`${fieldName} must be an array of strings.`, 400);
  }

  return value
    .map((item) => trimmedText(item))
    .filter((item) => item.length > 0);
}

function normalizeNullableNumber(
  value: unknown,
  fieldName: string
): number | null {
  if (value === null) return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw errorWithStatus(`${fieldName} must be a finite number or null.`, 400);
  }
  return Math.floor(numberValue);
}

function isWorkshopRole(value: string): value is WorkshopRole {
  return ALLOWED_WORKSHOP_ROLES.includes(value as WorkshopRole);
}

function normalizeWorkshopRole(value: unknown): WorkshopRole | null {
  const role = nullableText(value);
  if (role == null) return null;
  if (!isWorkshopRole(role)) {
    throw errorWithStatus(
      "workshopUserRole must be owner, branch_admin, or staff.",
      400
    );
  }
  return role;
}

async function ensureTenantExists(input: {
  supabase: SupabaseClient;
  tenantId: string | null;
}): Promise<void> {
  if (!input.tenantId) return;

  const { data, error } = await input.supabase
    .from("tenants")
    .select("id")
    .eq("id", input.tenantId)
    .maybeSingle();

  if (error || !data) {
    throw errorWithStatus("Invalid tenantId - tenant not found.", 400);
  }
}

function assertWorkshopFieldsComplete(
  row: Pick<
    AgentRow,
    "bms_owner_uid" | "bms_branch_id" | "workshop_user_role"
  >
): void {
  const hasAnyWorkshopField =
    row.bms_owner_uid != null ||
    row.bms_branch_id != null ||
    row.workshop_user_role != null;

  if (!hasAnyWorkshopField) return;

  if (!row.bms_owner_uid) {
    throw errorWithStatus(
      "workshopOwnerUid is required for workshop agents.",
      400
    );
  }
  if (!row.bms_branch_id) {
    throw errorWithStatus(
      "workshopBranchId is required for workshop agents.",
      400
    );
  }
  if (!row.workshop_user_role) {
    throw errorWithStatus(
      "workshopUserRole is required for workshop agents.",
      400
    );
  }
}

function buildAgentPatch(
  existing: AgentRow,
  body: AgentUpdateInput
): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw errorWithStatus("Request body must be an object.", 400);
  }

  const patch: Record<string, unknown> = {};

  if (hasOwn(body, "tenantId")) patch.tenant_id = nullableText(body.tenantId);
  if (hasOwn(body, "queueIds")) {
    patch.queue_ids = normalizeTextArray(body.queueIds, "queueIds");
  }
  if (hasOwn(body, "allowedQueueIds")) {
    patch.allowed_queue_ids = normalizeTextArray(
      body.allowedQueueIds,
      "allowedQueueIds"
    );
  }
  if (hasOwn(body, "name")) {
    patch.name = requiredTrimmedText(body.name, "name");
  }
  if (hasOwn(body, "extension")) {
    patch.extension = trimmedText(body.extension);
  }
  if (hasOwn(body, "role")) {
    patch.role = requiredTrimmedText(body.role, "role");
  }
  if (hasOwn(body, "status")) {
    patch.status = requiredTrimmedText(body.status, "status");
  }
  if (hasOwn(body, "currentCaller")) {
    patch.current_caller = nullableText(body.currentCaller);
  }
  if (hasOwn(body, "callStartTime")) {
    patch.call_start_time = normalizeNullableNumber(
      body.callStartTime,
      "callStartTime"
    );
  }
  if (hasOwn(body, "email")) {
    patch.email = requiredTrimmedText(body.email, "email").toLowerCase();
  }
  if (hasOwn(body, "notes")) {
    patch.notes = String(body.notes ?? "");
  }
  if (hasOwn(body, "phoneNumber")) {
    patch.phone_number = trimmedText(body.phoneNumber);
  } else if (hasOwn(body, "phone")) {
    patch.phone_number = trimmedText(body.phone);
  }
  if (hasOwn(body, "groupIds")) {
    patch.group_ids = nullableText(body.groupIds);
  }
  if (hasOwn(body, "bmsOwnerUid")) {
    patch.bms_owner_uid = nullableText(body.bmsOwnerUid);
  } else if (hasOwn(body, "workshopOwnerUid")) {
    patch.bms_owner_uid = nullableText(body.workshopOwnerUid);
  }
  if (hasOwn(body, "bmsBranchId")) {
    patch.bms_branch_id = nullableText(body.bmsBranchId);
  } else if (hasOwn(body, "workshopBranchId")) {
    patch.bms_branch_id = nullableText(body.workshopBranchId);
  }
  if (hasOwn(body, "workshopUserRole")) {
    patch.workshop_user_role = normalizeWorkshopRole(body.workshopUserRole);
  }

  if (hasOwn(body, "agentType")) {
    const rawAgentType = trimmedText(body.agentType);
    const agentType =
      rawAgentType === "command-center" ? "command-centre" : rawAgentType;
    if (agentType !== "workshop" && agentType !== "command-centre") {
      throw errorWithStatus(
        "agentType must be workshop or command-centre.",
        400
      );
    }
    if (agentType === "command-centre") {
      patch.bms_owner_uid = null;
      patch.bms_branch_id = null;
      patch.workshop_user_role = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw errorWithStatus("Send at least one editable agent field.", 400);
  }

  const nextWorkshopFields = {
    bms_owner_uid:
      "bms_owner_uid" in patch
        ? (patch.bms_owner_uid as string | null)
        : existing.bms_owner_uid,
    bms_branch_id:
      "bms_branch_id" in patch
        ? (patch.bms_branch_id as string | null)
        : existing.bms_branch_id,
    workshop_user_role:
      "workshop_user_role" in patch
        ? (patch.workshop_user_role as WorkshopRole | null)
        : existing.workshop_user_role,
  };

  assertWorkshopFieldsComplete(nextWorkshopFields);
  return patch;
}

export async function listAgentsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: AgentListFilters;
}): Promise<AgentListResult> {
  const { limit, offset } = normalizeAgentPagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("agents")
    .select(AGENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false });

  const agentType = input.filters.agentType;
  if (agentType === "workshop") {
    q = q.or(
      "bms_owner_uid.not.is.null,bms_branch_id.not.is.null,workshop_user_role.not.is.null"
    );
  } else if (agentType === "command-centre") {
    q = q
      .is("bms_owner_uid", null)
      .is("bms_branch_id", null)
      .is("workshop_user_role", null);
  }

  const tenantId = input.filters.tenantId?.trim();
  const ownerUid = input.filters.ownerUid?.trim();
  const branchId = input.filters.branchId?.trim();
  const role = input.filters.role?.trim();
  const status = input.filters.status?.trim();
  const search = input.filters.search
    ?.trim()
    .replace(/[%*,()]/g, "")
    .trim();

  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (ownerUid) q = q.eq("bms_owner_uid", ownerUid);
  if (branchId) q = q.eq("bms_branch_id", branchId);
  if (role) q = q.eq("role", role);
  if (status) q = q.eq("status", status);
  if (search) {
    q = q.or(
      `name.ilike.%${search}%,email.ilike.%${search}%,extension.ilike.%${search}%,phone_number.ilike.%${search}%`
    );
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as AgentRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getAgentByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
}): Promise<AgentRow | null> {
  const agentId = input.agentId.trim();
  if (!agentId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_SELECT)
    .eq("id", agentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentRow | null) ?? null;
}

function agentTypeForRow(row: AgentRow): "command-centre" | "workshop" {
  return row.bms_owner_uid || row.bms_branch_id || row.workshop_user_role
    ? "workshop"
    : "command-centre";
}

function agentMatchesPerformanceFilters(
  row: AgentRow,
  filters: AgentPerformanceFilters
): boolean {
  if (filters.agentType && filters.agentType !== "all") {
    if (agentTypeForRow(row) !== filters.agentType) return false;
  }
  if (filters.tenantId?.trim() && row.tenant_id !== filters.tenantId.trim()) {
    return false;
  }
  if (filters.ownerUid?.trim() && row.bms_owner_uid !== filters.ownerUid.trim()) {
    return false;
  }
  if (filters.branchId?.trim() && row.bms_branch_id !== filters.branchId.trim()) {
    return false;
  }
  if (filters.role?.trim() && row.role !== filters.role.trim()) {
    return false;
  }
  if (filters.status?.trim() && row.status !== filters.status.trim()) {
    return false;
  }

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const searchable = [
      row.name,
      row.email,
      row.extension,
      row.phone_number,
    ].map((value) => value.toLowerCase());
    if (!searchable.some((value) => value.includes(search))) return false;
  }

  return true;
}

function emptyPerformanceMetrics(): AgentPerformanceRow["metrics"] {
  return {
    total_calls: 0,
    answered_calls: 0,
    missed_calls: 0,
    inbound_calls: 0,
    outbound_calls: 0,
    total_duration_seconds: 0,
    average_duration_seconds: 0,
    answer_rate_percent: 0,
    first_call_start_time: null,
    last_call_start_time: null,
  };
}

function finalizePerformanceMetrics(
  metrics: AgentPerformanceRow["metrics"]
): AgentPerformanceRow["metrics"] {
  return {
    ...metrics,
    average_duration_seconds:
      metrics.answered_calls > 0
        ? Math.round(metrics.total_duration_seconds / metrics.answered_calls)
        : 0,
    answer_rate_percent:
      metrics.total_calls > 0
        ? Math.round((metrics.answered_calls / metrics.total_calls) * 10000) /
          100
        : 0,
  };
}

async function fetchCallsForAgentPerformance(input: {
  supabase: SupabaseClient;
  agentIds: string[];
  filters: AgentPerformanceFilters;
}): Promise<CallRow[]> {
  if (input.agentIds.length === 0) return [];

  const rows: CallRow[] = [];
  let offset = 0;

  while (true) {
    let q = input.supabase
      .from("calls")
      .select("*")
      .in("agent_id", input.agentIds)
      .order("start_time", { ascending: true });

    const tenantId = input.filters.tenantId?.trim();
    const queueId = input.filters.queueId?.trim();
    const direction = input.filters.direction;
    const from = input.filters.from?.trim();
    const to = input.filters.to?.trim();

    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (queueId) q = q.eq("queue_id", queueId);
    if (direction) q = q.eq("direction", direction);
    if (from) q = q.gte("start_time", from);
    if (to) q = q.lte("start_time", to);

    const { data, error } = await q.range(
      offset,
      offset + CALLS_PAGE_SIZE - 1
    );
    if (error) throw new Error(error.message);

    const page = (data ?? []) as CallRow[];
    rows.push(...page);
    if (page.length < CALLS_PAGE_SIZE) break;
    offset += CALLS_PAGE_SIZE;
  }

  return rows;
}

export async function getAgentPerformanceInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: AgentPerformanceFilters;
}): Promise<AgentPerformanceResult> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const agentId = input.filters.agentId?.trim();

  let agentsResult: AgentListResult;
  if (agentId) {
    const agent = await getAgentByIdInSupabase({
      supabaseUrl: input.supabaseUrl,
      serviceRoleKey: input.serviceRoleKey,
      agentId,
    });
    const matchingAgent =
      agent && agentMatchesPerformanceFilters(agent, input.filters)
        ? [agent]
        : [];
    agentsResult = {
      data: matchingAgent,
      total: matchingAgent.length,
      limit: 1,
      offset: 0,
    };
  } else {
    agentsResult = await listAgentsInSupabase({
      supabaseUrl: input.supabaseUrl,
      serviceRoleKey: input.serviceRoleKey,
      filters: input.filters,
    });
  }

  const metricsByAgentId = new Map<string, AgentPerformanceRow["metrics"]>();
  for (const agent of agentsResult.data) {
    metricsByAgentId.set(agent.id, emptyPerformanceMetrics());
  }

  const calls = await fetchCallsForAgentPerformance({
    supabase,
    agentIds: agentsResult.data.map((agent) => agent.id),
    filters: input.filters,
  });

  for (const call of calls) {
    if (!call.agent_id) continue;
    const metrics = metricsByAgentId.get(call.agent_id);
    if (!metrics) continue;

    metrics.total_calls += 1;
    if (call.answer_time) {
      metrics.answered_calls += 1;
      metrics.total_duration_seconds += Math.max(
        0,
        Number(call.duration_seconds) || 0
      );
    } else {
      metrics.missed_calls += 1;
    }

    if (call.direction === "inbound") metrics.inbound_calls += 1;
    if (call.direction === "outbound") metrics.outbound_calls += 1;

    if (
      !metrics.first_call_start_time ||
      call.start_time < metrics.first_call_start_time
    ) {
      metrics.first_call_start_time = call.start_time;
    }
    if (
      !metrics.last_call_start_time ||
      call.start_time > metrics.last_call_start_time
    ) {
      metrics.last_call_start_time = call.start_time;
    }
  }

  const data = agentsResult.data.map((agent) => ({
    agent,
    metrics: finalizePerformanceMetrics(
      metricsByAgentId.get(agent.id) ?? emptyPerformanceMetrics()
    ),
  }));

  const totals = finalizePerformanceMetrics(
    data.reduce((acc, row) => {
      acc.total_calls += row.metrics.total_calls;
      acc.answered_calls += row.metrics.answered_calls;
      acc.missed_calls += row.metrics.missed_calls;
      acc.inbound_calls += row.metrics.inbound_calls;
      acc.outbound_calls += row.metrics.outbound_calls;
      acc.total_duration_seconds += row.metrics.total_duration_seconds;
      if (
        row.metrics.first_call_start_time &&
        (!acc.first_call_start_time ||
          row.metrics.first_call_start_time < acc.first_call_start_time)
      ) {
        acc.first_call_start_time = row.metrics.first_call_start_time;
      }
      if (
        row.metrics.last_call_start_time &&
        (!acc.last_call_start_time ||
          row.metrics.last_call_start_time > acc.last_call_start_time)
      ) {
        acc.last_call_start_time = row.metrics.last_call_start_time;
      }
      return acc;
    }, emptyPerformanceMetrics())
  );

  return {
    data,
    totals,
    total: agentsResult.total,
    limit: agentsResult.limit,
    offset: agentsResult.offset,
  };
}

export async function updateAgentInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
  body: AgentUpdateInput;
}): Promise<AgentRow | null> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const existing = await getAgentByIdInSupabase(input);
  if (!existing) return null;

  const patch = buildAgentPatch(existing, input.body);
  if ("tenant_id" in patch) {
    await ensureTenantExists({
      supabase,
      tenantId: patch.tenant_id as string | null,
    });
  }

  const { data, error } = await supabase
    .from("agents")
    .update(patch)
    .eq("id", existing.id)
    .select(AGENT_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return data as AgentRow;
}

export async function deleteAgentInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
}): Promise<AgentDeleteResult | null> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const existing = await getAgentByIdInSupabase(input);
  if (!existing) return null;

  const { data, error } = await supabase
    .from("agents")
    .delete()
    .eq("id", existing.id)
    .select(AGENT_SELECT)
    .single();

  if (error) throw new Error(error.message);

  const agent = data as AgentRow;
  const warnings: string[] = [];
  let authUserDeleted = false;

  if (agent.user_id) {
    const { error: roleErr } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", agent.user_id);
    if (roleErr) {
      warnings.push(`Failed to delete user_roles rows: ${roleErr.message}`);
    }

    const { error: authErr } = await supabase.auth.admin.deleteUser(
      agent.user_id
    );
    if (authErr) {
      warnings.push(`Failed to delete auth user: ${authErr.message}`);
    } else {
      authUserDeleted = true;
    }
  }

  return {
    agent,
    userId: agent.user_id,
    authUserDeleted,
    warnings,
  };
}
