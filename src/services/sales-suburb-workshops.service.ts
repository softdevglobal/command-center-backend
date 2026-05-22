import type {
  SalesSuburbWorkshopInput,
  SalesSuburbWorkshopListFilters,
  SalesSuburbWorkshopListResult,
  SalesSuburbWorkshopRow,
  SalesSuburbWorkshopUpdateInput,
} from "../types/sales-suburb-workshop.types.js";
import {
  createSalesSuburbWorkshopViaSupabase,
  deleteSalesSuburbWorkshopViaSupabase,
  getSalesSuburbWorkshopByIdViaSupabase,
  listSalesSuburbWorkshopsViaSupabase,
  updateSalesSuburbWorkshopViaSupabase,
} from "./shared/sales-suburb-workshops.pipeline.js";

export async function listSalesSuburbWorkshops(
  filters: SalesSuburbWorkshopListFilters
): Promise<SalesSuburbWorkshopListResult> {
  return listSalesSuburbWorkshopsViaSupabase({ filters });
}

export async function getSalesSuburbWorkshopById(
  id: string
): Promise<SalesSuburbWorkshopRow | null> {
  return getSalesSuburbWorkshopByIdViaSupabase({ id });
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
