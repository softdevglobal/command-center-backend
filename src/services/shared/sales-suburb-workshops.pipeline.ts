import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import type {
  SalesSuburbWorkshopInput,
  SalesSuburbWorkshopListFilters,
  SalesSuburbWorkshopListResult,
  SalesSuburbWorkshopRow,
  SalesSuburbWorkshopUpdateInput,
} from "../../types/sales-suburb-workshop.types.js";
import {
  createSalesSuburbWorkshopInSupabase,
  deleteSalesSuburbWorkshopInSupabase,
  getSalesSuburbWorkshopByIdInSupabase,
  listSalesSuburbWorkshopsInSupabase,
  updateSalesSuburbWorkshopInSupabase,
} from "./supabase-sales-suburb-workshops.service.js";

function assertSupabaseForSalesSuburbWorkshops(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for sales suburb workshop APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.sales_suburb_workshops`. */
export async function listSalesSuburbWorkshopsViaSupabase(input: {
  filters: SalesSuburbWorkshopListFilters;
}): Promise<SalesSuburbWorkshopListResult> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSalesSuburbWorkshops();
  return listSalesSuburbWorkshopsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getSalesSuburbWorkshopByIdViaSupabase(input: {
  id: string;
}): Promise<SalesSuburbWorkshopRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSalesSuburbWorkshops();
  return getSalesSuburbWorkshopByIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}

export async function createSalesSuburbWorkshopViaSupabase(input: {
  body: SalesSuburbWorkshopInput;
}): Promise<SalesSuburbWorkshopRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSalesSuburbWorkshops();
  return createSalesSuburbWorkshopInSupabase({
    supabaseUrl,
    serviceRoleKey,
    body: input.body,
  });
}

export async function updateSalesSuburbWorkshopViaSupabase(input: {
  id: string;
  body: SalesSuburbWorkshopUpdateInput;
}): Promise<SalesSuburbWorkshopRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSalesSuburbWorkshops();
  return updateSalesSuburbWorkshopInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
    body: input.body,
  });
}

export async function deleteSalesSuburbWorkshopViaSupabase(input: {
  id: string;
}): Promise<SalesSuburbWorkshopRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSalesSuburbWorkshops();
  return deleteSalesSuburbWorkshopInSupabase({
    supabaseUrl,
    serviceRoleKey,
    id: input.id,
  });
}
