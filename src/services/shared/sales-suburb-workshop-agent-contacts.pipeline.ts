import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import type {
  SalesSuburbWorkshopAgentContactInput,
  SalesSuburbWorkshopAgentContactListFilters,
  SalesSuburbWorkshopAgentContactListResult,
  SalesSuburbWorkshopAgentContactRow,
  SalesSuburbWorkshopAgentContactUpdateInput,
} from "../../types/sales-suburb-workshop-agent-contact.types.js";
import {
  createSalesSuburbWorkshopAgentContactInSupabase,
  deleteSalesSuburbWorkshopAgentContactInSupabase,
  getSalesSuburbWorkshopAgentContactByIdInSupabase,
  getSalesSuburbWorkshopAgentContactByPairInSupabase,
  listSalesSuburbWorkshopAgentContactsInSupabase,
  updateSalesSuburbWorkshopAgentContactInSupabase,
} from "./supabase-sales-suburb-workshop-agent-contacts.service.js";

function assertSupabaseForSalesSuburbWorkshopAgentContacts(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for sales suburb workshop agent contact APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.sales_suburb_workshop_agent_contact`. */
export async function listSalesSuburbWorkshopAgentContactsViaSupabase(input: {
  filters: SalesSuburbWorkshopAgentContactListFilters;
}): Promise<SalesSuburbWorkshopAgentContactListResult> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesSuburbWorkshopAgentContacts();
  return listSalesSuburbWorkshopAgentContactsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getSalesSuburbWorkshopAgentContactByIdViaSupabase(input: {
  id: string;
}): Promise<SalesSuburbWorkshopAgentContactRow | null> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesSuburbWorkshopAgentContacts();
  return getSalesSuburbWorkshopAgentContactByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}

export async function getSalesSuburbWorkshopAgentContactByPairViaSupabase(input: {
  workshopId: string;
  agentId: string;
}): Promise<SalesSuburbWorkshopAgentContactRow | null> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesSuburbWorkshopAgentContacts();
  return getSalesSuburbWorkshopAgentContactByPairInSupabase({
    supabaseUrl,
    serviceRoleKey,
    workshopId: input.workshopId,
    agentId: input.agentId,
  });
}

export async function createSalesSuburbWorkshopAgentContactViaSupabase(input: {
  body: SalesSuburbWorkshopAgentContactInput;
}): Promise<SalesSuburbWorkshopAgentContactRow> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesSuburbWorkshopAgentContacts();
  return createSalesSuburbWorkshopAgentContactInSupabase({
    supabaseUrl,
    serviceRoleKey,
    body: input.body,
  });
}

export async function updateSalesSuburbWorkshopAgentContactViaSupabase(input: {
  id: string;
  body: SalesSuburbWorkshopAgentContactUpdateInput;
}): Promise<SalesSuburbWorkshopAgentContactRow> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesSuburbWorkshopAgentContacts();
  return updateSalesSuburbWorkshopAgentContactInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
    body: input.body,
  });
}

export async function deleteSalesSuburbWorkshopAgentContactViaSupabase(input: {
  id: string;
}): Promise<SalesSuburbWorkshopAgentContactRow> {
  const { supabaseUrl, serviceRoleKey } =
    assertSupabaseForSalesSuburbWorkshopAgentContacts();
  return deleteSalesSuburbWorkshopAgentContactInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}
