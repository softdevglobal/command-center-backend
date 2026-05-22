/** Row shape for `public.sales_agent_suburb_assignments`. */
export type SalesAgentSuburbAssignmentRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  suburb: string;
  created_at: string;
};

/** POST /api/sales-agent-suburb-assignments body (camelCase). */
export type SalesAgentSuburbAssignmentInput = {
  tenantId: string;
  agentId: string;
  suburb: string;
};

/** PATCH /api/sales-agent-suburb-assignments/:id body. */
export type SalesAgentSuburbAssignmentUpdateInput =
  Partial<SalesAgentSuburbAssignmentInput>;

export type SalesAgentSuburbAssignmentListFilters = {
  tenantId?: string;
  agentId?: string;
  suburb?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type SalesAgentSuburbAssignmentListResult = {
  data: SalesAgentSuburbAssignmentRow[];
  total: number;
  limit: number;
  offset: number;
};

export const SALES_AGENT_SUBURB_ASSIGNMENT_PATCHABLE_FIELDS = [
  "tenantId",
  "agentId",
  "suburb",
] as const;

type SalesAgentSuburbAssignmentWritableRow = {
  tenant_id: string;
  agent_id: string;
  suburb: string;
};

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function readStringAlias(
  input: Record<string, unknown>,
  camel: string,
  snake: string
): string | undefined {
  const camelValue = stringField(input[camel]);
  if (camelValue !== undefined) return camelValue;
  return stringField(input[snake]);
}

export function toSalesAgentSuburbAssignmentInsertRow(
  input: SalesAgentSuburbAssignmentInput
): SalesAgentSuburbAssignmentWritableRow {
  const source = input as Record<string, unknown>;
  return {
    tenant_id: readStringAlias(source, "tenantId", "tenant_id") ?? "",
    agent_id: readStringAlias(source, "agentId", "agent_id") ?? "",
    suburb: readStringAlias(source, "suburb", "suburb") ?? "",
  };
}

export function toSalesAgentSuburbAssignmentUpdatePatch(
  input: SalesAgentSuburbAssignmentUpdateInput
): Partial<SalesAgentSuburbAssignmentWritableRow> | null {
  const source = input as Record<string, unknown>;
  const patch: Partial<SalesAgentSuburbAssignmentWritableRow> = {};

  const tenantId = readStringAlias(source, "tenantId", "tenant_id");
  if (tenantId !== undefined) patch.tenant_id = tenantId;

  const agentId = readStringAlias(source, "agentId", "agent_id");
  if (agentId !== undefined) patch.agent_id = agentId;

  const suburb = readStringAlias(source, "suburb", "suburb");
  if (suburb !== undefined) patch.suburb = suburb;

  return Object.keys(patch).length > 0 ? patch : null;
}
