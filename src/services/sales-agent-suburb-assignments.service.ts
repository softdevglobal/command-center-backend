import type {
  SalesAgentSuburbAssignmentInput,
  SalesAgentSuburbAssignmentListFilters,
  SalesAgentSuburbAssignmentListResult,
  SalesAgentSuburbAssignmentRow,
  SalesAgentSuburbAssignmentUpdateInput,
} from "../types/sales-agent-suburb-assignment.types.js";
import {
  createSalesAgentSuburbAssignmentViaSupabase,
  deleteSalesAgentSuburbAssignmentViaSupabase,
  getSalesAgentSuburbAssignmentByIdViaSupabase,
  listSalesAgentSuburbAssignmentsViaSupabase,
  updateSalesAgentSuburbAssignmentViaSupabase,
} from "./shared/sales-agent-suburb-assignments.pipeline.js";

export async function listSalesAgentSuburbAssignments(
  filters: SalesAgentSuburbAssignmentListFilters
): Promise<SalesAgentSuburbAssignmentListResult> {
  return listSalesAgentSuburbAssignmentsViaSupabase({ filters });
}

export async function getSalesAgentSuburbAssignmentById(
  id: string
): Promise<SalesAgentSuburbAssignmentRow | null> {
  return getSalesAgentSuburbAssignmentByIdViaSupabase({ id });
}

export async function createSalesAgentSuburbAssignment(
  body: SalesAgentSuburbAssignmentInput
): Promise<SalesAgentSuburbAssignmentRow> {
  return createSalesAgentSuburbAssignmentViaSupabase({ body });
}

export async function updateSalesAgentSuburbAssignment(
  id: string,
  body: SalesAgentSuburbAssignmentUpdateInput
): Promise<SalesAgentSuburbAssignmentRow> {
  return updateSalesAgentSuburbAssignmentViaSupabase({ id, body });
}

export async function deleteSalesAgentSuburbAssignment(
  id: string
): Promise<SalesAgentSuburbAssignmentRow> {
  return deleteSalesAgentSuburbAssignmentViaSupabase({ id });
}
