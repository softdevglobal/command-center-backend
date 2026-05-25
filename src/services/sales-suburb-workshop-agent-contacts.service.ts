import type {
  SalesSuburbWorkshopAgentContactInput,
  SalesSuburbWorkshopAgentContactListFilters,
  SalesSuburbWorkshopAgentContactListResult,
  SalesSuburbWorkshopAgentContactRow,
  SalesSuburbWorkshopAgentContactUpdateInput,
} from "../types/sales-suburb-workshop-agent-contact.types.js";
import {
  createSalesSuburbWorkshopAgentContactViaSupabase,
  deleteSalesSuburbWorkshopAgentContactViaSupabase,
  getSalesSuburbWorkshopAgentContactByIdViaSupabase,
  getSalesSuburbWorkshopAgentContactByPairViaSupabase,
  listSalesSuburbWorkshopAgentContactsViaSupabase,
  updateSalesSuburbWorkshopAgentContactViaSupabase,
} from "./shared/sales-suburb-workshop-agent-contacts.pipeline.js";

export async function listSalesSuburbWorkshopAgentContacts(
  filters: SalesSuburbWorkshopAgentContactListFilters
): Promise<SalesSuburbWorkshopAgentContactListResult> {
  return listSalesSuburbWorkshopAgentContactsViaSupabase({ filters });
}

export async function getSalesSuburbWorkshopAgentContactById(
  id: string
): Promise<SalesSuburbWorkshopAgentContactRow | null> {
  return getSalesSuburbWorkshopAgentContactByIdViaSupabase({ id });
}

export async function getSalesSuburbWorkshopAgentContactByPair(input: {
  workshopId: string;
  agentId: string;
}): Promise<SalesSuburbWorkshopAgentContactRow | null> {
  return getSalesSuburbWorkshopAgentContactByPairViaSupabase(input);
}

export async function createSalesSuburbWorkshopAgentContact(
  body: SalesSuburbWorkshopAgentContactInput
): Promise<SalesSuburbWorkshopAgentContactRow> {
  return createSalesSuburbWorkshopAgentContactViaSupabase({ body });
}

export async function updateSalesSuburbWorkshopAgentContact(
  id: string,
  body: SalesSuburbWorkshopAgentContactUpdateInput
): Promise<SalesSuburbWorkshopAgentContactRow> {
  return updateSalesSuburbWorkshopAgentContactViaSupabase({ id, body });
}

export async function deleteSalesSuburbWorkshopAgentContact(
  id: string
): Promise<SalesSuburbWorkshopAgentContactRow> {
  return deleteSalesSuburbWorkshopAgentContactViaSupabase({ id });
}
