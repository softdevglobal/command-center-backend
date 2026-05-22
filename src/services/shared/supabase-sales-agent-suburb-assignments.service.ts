import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  SALES_AGENT_SUBURB_ASSIGNMENT_PATCHABLE_FIELDS,
  toSalesAgentSuburbAssignmentInsertRow,
  toSalesAgentSuburbAssignmentUpdatePatch,
  type SalesAgentSuburbAssignmentInput,
  type SalesAgentSuburbAssignmentListFilters,
  type SalesAgentSuburbAssignmentListResult,
  type SalesAgentSuburbAssignmentRow,
  type SalesAgentSuburbAssignmentUpdateInput,
} from "../../types/sales-agent-suburb-assignment.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: SalesAgentSuburbAssignmentListFilters): {
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

function searchTerm(value: string): string {
  return value.trim().replace(/[,()]/g, " ");
}

function throwSalesAgentSuburbAssignmentDbError(error: {
  code?: string;
  message: string;
}): never {
  const duplicate =
    error.code === "23505" || /duplicate key|unique constraint/i.test(error.message);
  if (duplicate) {
    const e = new Error(
      "Agent is already assigned to that suburb for this tenant."
    );
    (e as Error & { statusCode?: number }).statusCode = 409;
    throw e;
  }

  const fk =
    error.code === "23503" ||
    /foreign key|violates foreign key/i.test(error.message);
  if (fk) {
    const e = new Error("Invalid tenantId or agentId — referenced row does not exist.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  throw new Error(error.message);
}

export async function listSalesAgentSuburbAssignmentsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: SalesAgentSuburbAssignmentListFilters;
}): Promise<SalesAgentSuburbAssignmentListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("sales_agent_suburb_assignments")
    .select("*", { count: "exact" })
    .order("suburb", { ascending: true })
    .order("agent_id", { ascending: true });

  const tenantId = input.filters.tenantId?.trim();
  const agentId = input.filters.agentId?.trim();
  const suburb = input.filters.suburb?.trim();
  const search = searchTerm(input.filters.search ?? "");

  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (agentId) q = q.eq("agent_id", agentId);
  if (suburb) q = q.ilike("suburb", suburb);
  if (search) {
    q = q.or([`suburb.ilike.*${search}*`, `agent_id.ilike.*${search}*`].join(","));
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as SalesAgentSuburbAssignmentRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getSalesAgentSuburbAssignmentByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<SalesAgentSuburbAssignmentRow | null> {
  const id = input.id.trim();
  if (!id) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalesAgentSuburbAssignmentRow | null) ?? null;
}

export async function createSalesAgentSuburbAssignmentInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  body: SalesAgentSuburbAssignmentInput;
}): Promise<SalesAgentSuburbAssignmentRow> {
  const row = toSalesAgentSuburbAssignmentInsertRow(input.body);

  if (!row.tenant_id || !row.agent_id || !row.suburb) {
    throw new Error("tenantId, agentId, and suburb are required.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .insert(row)
    .select("*")
    .single();

  if (error) throwSalesAgentSuburbAssignmentDbError(error);
  return data as SalesAgentSuburbAssignmentRow;
}

export async function updateSalesAgentSuburbAssignmentInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
  body: SalesAgentSuburbAssignmentUpdateInput;
}): Promise<SalesAgentSuburbAssignmentRow> {
  const id = input.id.trim();
  if (!id) {
    const e = new Error("id is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const patch = toSalesAgentSuburbAssignmentUpdatePatch(input.body);
  if (!patch) {
    throw new Error(
      `Provide at least one field to update: ${SALES_AGENT_SUBURB_ASSIGNMENT_PATCHABLE_FIELDS.join(
        ", "
      )}.`
    );
  }

  if (patch.tenant_id !== undefined && !patch.tenant_id) {
    throw new Error("tenantId cannot be empty.");
  }
  if (patch.agent_id !== undefined && !patch.agent_id) {
    throw new Error("agentId cannot be empty.");
  }
  if (patch.suburb !== undefined && !patch.suburb) {
    throw new Error("suburb cannot be empty.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throwSalesAgentSuburbAssignmentDbError(error);
  if (!data) {
    const e = new Error("Sales agent suburb assignment not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as SalesAgentSuburbAssignmentRow;
}

export async function deleteSalesAgentSuburbAssignmentInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<SalesAgentSuburbAssignmentRow> {
  const id = input.id.trim();
  if (!id) {
    const e = new Error("id is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .delete()
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    const e = new Error("Sales agent suburb assignment not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as SalesAgentSuburbAssignmentRow;
}
