import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  SALES_SUBURB_WORKSHOP_PATCHABLE_FIELDS,
  toSalesSuburbWorkshopInsertRow,
  toSalesSuburbWorkshopUpdatePatch,
  type SalesSuburbWorkshopInput,
  type SalesSuburbWorkshopAssignedListInput,
  type SalesSuburbWorkshopListFilters,
  type SalesSuburbWorkshopListResult,
  type SalesSuburbWorkshopRow,
  type SalesSuburbWorkshopUpdateInput,
} from "../../types/sales-suburb-workshop.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(filters: SalesSuburbWorkshopListFilters): {
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

function normalizedSuburb(value: string): string {
  return value.trim().toLowerCase();
}

function applyWorkshopSearch<T extends { or: (filters: string) => T }>(
  query: T,
  search: string
): T {
  if (!search) return query;
  return query.or(
    [
      `suburb.ilike.*${search}*`,
      `workshop_name.ilike.*${search}*`,
      `phone_number.ilike.*${search}*`,
      `owner_name.ilike.*${search}*`,
      `owner_email.ilike.*${search}*`,
      `location.ilike.*${search}*`,
      `website.ilike.*${search}*`,
    ].join(",")
  );
}

function throwSalesSuburbWorkshopDbError(error: {
  code?: string;
  message: string;
}): never {
  const fk =
    error.code === "23503" ||
    /foreign key|violates foreign key/i.test(error.message);
  if (fk) {
    const e = new Error("Invalid tenantId — referenced tenant does not exist.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const check =
    error.code === "23514" ||
    /sales_suburb_workshops_suburb_nonempty|check constraint/i.test(
      error.message
    );
  if (check) {
    const e = new Error("suburb must be non-empty.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  throw new Error(error.message);
}

export async function listSalesSuburbWorkshopsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: SalesSuburbWorkshopListFilters;
}): Promise<SalesSuburbWorkshopListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("sales_suburb_workshops")
    .select("*", { count: "exact" })
    .order("suburb_normalized", { ascending: true })
    .order("workshop_name", { ascending: true });

  const tenantId = input.filters.tenantId?.trim();
  const suburb = input.filters.suburb?.trim();
  const search = searchTerm(input.filters.search ?? "");

  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (suburb) q = q.eq("suburb_normalized", normalizedSuburb(suburb));
  q = applyWorkshopSearch(q, search);

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as SalesSuburbWorkshopRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function listAssignedSalesSuburbWorkshopsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  assignment: SalesSuburbWorkshopAssignedListInput;
}): Promise<SalesSuburbWorkshopListResult> {
  const agentId = input.assignment.agentId.trim();
  const { filters } = input.assignment;
  const { limit, offset } = normalizePagination(filters);
  if (!agentId) {
    return { data: [], total: 0, limit, offset };
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  let assignmentQuery = supabase
    .from("sales_agent_suburb_assignments")
    .select("tenant_id, suburb")
    .eq("agent_id", agentId);

  const tenantId = filters.tenantId?.trim();
  const suburb = filters.suburb?.trim();
  const search = searchTerm(filters.search ?? "");

  if (tenantId) assignmentQuery = assignmentQuery.eq("tenant_id", tenantId);
  if (suburb) assignmentQuery = assignmentQuery.ilike("suburb", suburb);

  const { data: assignmentRows, error: assignmentError } = await assignmentQuery;
  if (assignmentError) throw new Error(assignmentError.message);

  const assignedSuburbs = new Set<string>();
  for (const row of assignmentRows ?? []) {
    const scope = row as { tenant_id?: string; suburb?: string };
    const scopeSuburb = normalizedSuburb(scope.suburb ?? "");
    if (scopeSuburb) assignedSuburbs.add(scopeSuburb);
  }

  if (assignedSuburbs.size === 0) {
    return { data: [], total: 0, limit, offset };
  }

  let q = supabase
    .from("sales_suburb_workshops")
    .select("*")
    .in("suburb_normalized", [...assignedSuburbs]);

  if (tenantId) q = q.eq("tenant_id", tenantId);
  q = applyWorkshopSearch(q, search);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rowsById = new Map<string, SalesSuburbWorkshopRow>();
  for (const row of (data ?? []) as SalesSuburbWorkshopRow[]) {
    rowsById.set(row.id, row);
  }

  const sorted = [...rowsById.values()].sort((a, b) => {
    const suburbCompare = a.suburb_normalized.localeCompare(b.suburb_normalized);
    if (suburbCompare !== 0) return suburbCompare;
    return a.workshop_name.localeCompare(b.workshop_name);
  });

  return {
    data: sorted.slice(offset, offset + limit),
    total: sorted.length,
    limit,
    offset,
  };
}

export async function agentMayViewSalesSuburbWorkshopInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
  row: SalesSuburbWorkshopRow;
}): Promise<boolean> {
  const agentId = input.agentId.trim();
  if (!agentId) return false;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .select("id")
    .eq("agent_id", agentId)
    .ilike("suburb", input.row.suburb_normalized)
    .limit(1);

  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function agentMayCreateSalesSuburbWorkshopInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
  tenantId: string;
  suburb: string;
}): Promise<boolean> {
  const agentId = input.agentId.trim();
  const suburb = normalizedSuburb(input.suburb);
  if (!agentId || !suburb) return false;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .select("id")
    .eq("agent_id", agentId)
    .ilike("suburb", suburb)
    .limit(1);

  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function getAgentAssignedTenantIdForSuburbInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  agentId: string;
  suburb: string;
}): Promise<string | null> {
  const agentId = input.agentId.trim();
  const suburb = normalizedSuburb(input.suburb);
  if (!agentId || !suburb) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .select("tenant_id")
    .eq("agent_id", agentId)
    .ilike("suburb", suburb)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { tenant_id?: string } | undefined;
  return typeof row?.tenant_id === "string" && row.tenant_id.trim() !== ""
    ? row.tenant_id
    : null;
}

export async function getSalesSuburbWorkshopByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<SalesSuburbWorkshopRow | null> {
  const id = input.id.trim();
  if (!id) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshops")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalesSuburbWorkshopRow | null) ?? null;
}

export async function createSalesSuburbWorkshopInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  body: SalesSuburbWorkshopInput;
}): Promise<SalesSuburbWorkshopRow> {
  const row = toSalesSuburbWorkshopInsertRow(input.body);

  if (!row.tenant_id || !row.suburb) {
    throw new Error("tenantId and suburb are required.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshops")
    .insert(row)
    .select("*")
    .single();

  if (error) throwSalesSuburbWorkshopDbError(error);
  return data as SalesSuburbWorkshopRow;
}

export async function updateSalesSuburbWorkshopInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
  body: SalesSuburbWorkshopUpdateInput;
}): Promise<SalesSuburbWorkshopRow> {
  const id = input.id.trim();
  if (!id) {
    const e = new Error("id is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const patch = toSalesSuburbWorkshopUpdatePatch(input.body);
  if (!patch) {
    throw new Error(
      `Provide at least one field to update: ${SALES_SUBURB_WORKSHOP_PATCHABLE_FIELDS.join(
        ", "
      )}.`
    );
  }

  if (patch.tenant_id !== undefined && !patch.tenant_id) {
    throw new Error("tenantId cannot be empty.");
  }
  if (patch.suburb !== undefined && !patch.suburb) {
    throw new Error("suburb cannot be empty.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshops")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throwSalesSuburbWorkshopDbError(error);
  if (!data) {
    const e = new Error("Sales suburb workshop not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as SalesSuburbWorkshopRow;
}

export async function deleteSalesSuburbWorkshopInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<SalesSuburbWorkshopRow> {
  const id = input.id.trim();
  if (!id) {
    const e = new Error("id is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshops")
    .delete()
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    const e = new Error("Sales suburb workshop not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as SalesSuburbWorkshopRow;
}
