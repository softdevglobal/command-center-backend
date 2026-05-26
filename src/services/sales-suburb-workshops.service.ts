import type {
  SalesSuburbWorkshopInput,
  SalesSuburbWorkshopAssignedListInput,
  SalesSuburbWorkshopListFilters,
  SalesSuburbWorkshopListResult,
  SalesSuburbWorkshopRow,
  SalesSuburbWorkshopUpdateInput,
} from "../types/sales-suburb-workshop.types.js";
import {
  agentMayCreateSalesSuburbWorkshopViaSupabase,
  agentMayViewSalesSuburbWorkshopViaSupabase,
  createSalesSuburbWorkshopViaSupabase,
  deleteSalesSuburbWorkshopViaSupabase,
  getAgentAssignedTenantIdForSuburbViaSupabase,
  getSalesSuburbWorkshopByIdViaSupabase,
  listAssignedSalesSuburbWorkshopsViaSupabase,
  listSalesSuburbWorkshopsViaSupabase,
  updateSalesSuburbWorkshopViaSupabase,
} from "./shared/sales-suburb-workshops.pipeline.js";

export async function listSalesSuburbWorkshops(
  filters: SalesSuburbWorkshopListFilters
): Promise<SalesSuburbWorkshopListResult> {
  return listSalesSuburbWorkshopsViaSupabase({ filters });
}

export async function listAssignedSalesSuburbWorkshops(
  assignment: SalesSuburbWorkshopAssignedListInput
): Promise<SalesSuburbWorkshopListResult> {
  return listAssignedSalesSuburbWorkshopsViaSupabase(assignment);
}

export async function getSalesSuburbWorkshopById(
  id: string
): Promise<SalesSuburbWorkshopRow | null> {
  return getSalesSuburbWorkshopByIdViaSupabase({ id });
}

export async function agentMayViewSalesSuburbWorkshop(input: {
  agentId: string;
  row: SalesSuburbWorkshopRow;
}): Promise<boolean> {
  return agentMayViewSalesSuburbWorkshopViaSupabase(input);
}

export async function agentMayCreateSalesSuburbWorkshop(input: {
  agentId: string;
  tenantId: string;
  suburb: string;
}): Promise<boolean> {
  return agentMayCreateSalesSuburbWorkshopViaSupabase(input);
}

export async function getAgentAssignedTenantIdForSuburb(input: {
  agentId: string;
  suburb: string;
}): Promise<string | null> {
  return getAgentAssignedTenantIdForSuburbViaSupabase(input);
}

export async function createSalesSuburbWorkshop(
  body: SalesSuburbWorkshopInput
): Promise<SalesSuburbWorkshopRow> {
  return createSalesSuburbWorkshopViaSupabase({ body });
}

export async function updateSalesSuburbWorkshop(
  id: string,
  body: SalesSuburbWorkshopUpdateInput
): Promise<SalesSuburbWorkshopRow> {
  return updateSalesSuburbWorkshopViaSupabase({ id, body });
}

export async function deleteSalesSuburbWorkshop(
  id: string
): Promise<SalesSuburbWorkshopRow> {
  return deleteSalesSuburbWorkshopViaSupabase({ id });
}
