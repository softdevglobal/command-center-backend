import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import type {
  SalesAgentSuburbAssignmentInput,
  SalesAgentSuburbAssignmentListFilters,
  SalesAgentSuburbAssignmentListResult,
  SalesAgentSuburbAssignmentRow,
  SalesAgentSuburbAssignmentUpdateInput,
} from "../../types/sales-agent-suburb-assignment.types.js";
import {
  createSalesAgentSuburbAssignmentInSupabase,
  deleteSalesAgentSuburbAssignmentInSupabase,
  getSalesAgentSuburbAssignmentByIdInSupabase,
  listSalesAgentSuburbAssignmentsInSupabase,
  updateSalesAgentSuburbAssignmentInSupabase,
} from "./supabase-sales-agent-suburb-assignments.service.js";

function assertSupabaseForSalesAgentSuburbAssignments(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for sales agent suburb assignment APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.sales_agent_suburb_assignments`. */
export async function listSalesAgentSuburbAssignmentsViaSupabase(input: {
  filters: SalesAgentSuburbAssignmentListFilters;
}): Promise<SalesAgentSuburbAssignmentListResult> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesAgentSuburbAssignments();
  return listSalesAgentSuburbAssignmentsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getSalesAgentSuburbAssignmentByIdViaSupabase(input: {
  id: string;
}): Promise<SalesAgentSuburbAssignmentRow | null> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesAgentSuburbAssignments();
  return getSalesAgentSuburbAssignmentByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}

export async function createSalesAgentSuburbAssignmentViaSupabase(input: {
  body: SalesAgentSuburbAssignmentInput;
}): Promise<SalesAgentSuburbAssignmentRow> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesAgentSuburbAssignments();
  return createSalesAgentSuburbAssignmentInSupabase({
    supabaseUrl,
    serviceRoleKey,
    body: input.body,
  });
}

export async function updateSalesAgentSuburbAssignmentViaSupabase(input: {
  id: string;
  body: SalesAgentSuburbAssignmentUpdateInput;
}): Promise<SalesAgentSuburbAssignmentRow> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesAgentSuburbAssignments();
  return updateSalesAgentSuburbAssignmentInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
    body: input.body,
  });
}

export async function deleteSalesAgentSuburbAssignmentViaSupabase(input: {
  id: string;
}): Promise<SalesAgentSuburbAssignmentRow> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesAgentSuburbAssignments();
  return deleteSalesAgentSuburbAssignmentInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}
