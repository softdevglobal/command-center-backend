import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  SALES_SUBURB_WORKSHOP_AGENT_CONTACT_PATCHABLE_FIELDS,
  toSalesSuburbWorkshopAgentContactInsertRow,
  toSalesSuburbWorkshopAgentContactUpdatePatch,
  type SalesSuburbWorkshopAgentContactInput,
  type SalesSuburbWorkshopAgentContactListFilters,
  type SalesSuburbWorkshopAgentContactListResult,
  type SalesSuburbWorkshopAgentContactRow,
  type SalesSuburbWorkshopAgentContactUpdateInput,
} from "../../types/sales-suburb-workshop-agent-contact.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizePagination(
  filters: SalesSuburbWorkshopAgentContactListFilters
): {
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

function throwSalesSuburbWorkshopAgentContactDbError(error: {
  code?: string;
  message: string;
}): never {
  const duplicate =
    error.code === "23505" || /duplicate key|unique constraint/i.test(error.message);
  if (duplicate) {
    const e = new Error("Contact row already exists for this workshop and agent.");
    (e as Error & { statusCode?: number }).statusCode = 409;
    throw e;
  }

  const fk =
    error.code === "23503" ||
    /foreign key|violates foreign key/i.test(error.message);
  if (fk) {
    const e = new Error("Invalid tenantId or workshopId — referenced row does not exist.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  throw new Error(error.message);
}

export async function listSalesSuburbWorkshopAgentContactsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: SalesSuburbWorkshopAgentContactListFilters;
}): Promise<SalesSuburbWorkshopAgentContactListResult> {
  const { limit, offset } = normalizePagination(input.filters);
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);

  let q = supabase
    .from("sales_suburb_workshop_agent_contact")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  const tenantId = input.filters.tenantId?.trim();
  const workshopId = input.filters.workshopId?.trim();
  const agentId = input.filters.agentId?.trim();
  const callStatus = input.filters.callStatus?.trim();
  const from = input.filters.from?.trim();
  const to = input.filters.to?.trim();

  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (workshopId) q = q.eq("workshop_id", workshopId);
  if (agentId) q = q.eq("agent_id", agentId);
  if (callStatus) q = q.eq("call_status", callStatus);
  if (from) q = q.gte("updated_at", from);
  if (to) q = q.lte("updated_at", to);

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  return {
    data: (data ?? []) as SalesSuburbWorkshopAgentContactRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getSalesSuburbWorkshopAgentContactByIdInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<SalesSuburbWorkshopAgentContactRow | null> {
  const id = input.id.trim();
  if (!id) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshop_agent_contact")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalesSuburbWorkshopAgentContactRow | null) ?? null;
}

export async function getSalesSuburbWorkshopAgentContactByPairInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  workshopId: string;
  agentId: string;
}): Promise<SalesSuburbWorkshopAgentContactRow | null> {
  const workshopId = input.workshopId.trim();
  const agentId = input.agentId.trim();
  if (!workshopId || !agentId) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshop_agent_contact")
    .select("*")
    .eq("workshop_id", workshopId)
    .eq("agent_id", agentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalesSuburbWorkshopAgentContactRow | null) ?? null;
}

export async function createSalesSuburbWorkshopAgentContactInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  body: SalesSuburbWorkshopAgentContactInput;
}): Promise<SalesSuburbWorkshopAgentContactRow> {
  const row = toSalesSuburbWorkshopAgentContactInsertRow(input.body);
  if (!row.tenant_id || !row.workshop_id || !row.agent_id) {
    throw new Error("tenantId, workshopId, and agentId are required.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshop_agent_contact")
    .insert(row)
    .select("*")
    .single();

  if (error) throwSalesSuburbWorkshopAgentContactDbError(error);
  return data as SalesSuburbWorkshopAgentContactRow;
}

export async function updateSalesSuburbWorkshopAgentContactInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
  body: SalesSuburbWorkshopAgentContactUpdateInput;
}): Promise<SalesSuburbWorkshopAgentContactRow> {
  const id = input.id.trim();
  if (!id) {
    const e = new Error("id is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const patch = toSalesSuburbWorkshopAgentContactUpdatePatch(input.body);
  if (!patch) {
    throw new Error(
      `Provide at least one field to update: ${SALES_SUBURB_WORKSHOP_AGENT_CONTACT_PATCHABLE_FIELDS.join(
        ", "
      )}.`
    );
  }

  if (patch.tenant_id !== undefined && !patch.tenant_id) {
    throw new Error("tenantId cannot be empty.");
  }
  if (patch.workshop_id !== undefined && !patch.workshop_id) {
    throw new Error("workshopId cannot be empty.");
  }
  if (patch.agent_id !== undefined && !patch.agent_id) {
    throw new Error("agentId cannot be empty.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshop_agent_contact")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throwSalesSuburbWorkshopAgentContactDbError(error);
  if (!data) {
    const e = new Error("Sales suburb workshop agent contact not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as SalesSuburbWorkshopAgentContactRow;
}

export async function deleteSalesSuburbWorkshopAgentContactInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  id: string;
}): Promise<SalesSuburbWorkshopAgentContactRow> {
  const id = input.id.trim();
  if (!id) {
    const e = new Error("id is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("sales_suburb_workshop_agent_contact")
    .delete()
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    const e = new Error("Sales suburb workshop agent contact not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as SalesSuburbWorkshopAgentContactRow;
}
