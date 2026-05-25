/** Row shape for `public.sales_suburb_workshop_agent_contact`. */
export type SalesSuburbWorkshopAgentContactRow = {
  id: string;
  tenant_id: string;
  workshop_id: string;
  agent_id: string;
  call_status: string | null;
  first_called_at: string | null;
  follow_up_at: string | null;
  remarks: string;
  created_at: string;
  updated_at: string;
};

/** POST /api/sales-suburb-workshop-agent-contacts body (camelCase). */
export type SalesSuburbWorkshopAgentContactInput = {
  tenantId?: string;
  workshopId: string;
  agentId?: string;
  callStatus?: string | null;
  firstCalledAt?: string | null;
  followUpAt?: string | null;
  remarks?: string;
};

/** PATCH /api/sales-suburb-workshop-agent-contacts/:id body. */
export type SalesSuburbWorkshopAgentContactUpdateInput =
  Partial<SalesSuburbWorkshopAgentContactInput>;

export type SalesSuburbWorkshopAgentContactListFilters = {
  tenantId?: string;
  workshopId?: string;
  agentId?: string;
  callStatus?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type SalesSuburbWorkshopAgentContactListResult = {
  data: SalesSuburbWorkshopAgentContactRow[];
  total: number;
  limit: number;
  offset: number;
};

export const SALES_SUBURB_WORKSHOP_AGENT_CONTACT_PATCHABLE_FIELDS = [
  "tenantId",
  "workshopId",
  "agentId",
  "callStatus",
  "firstCalledAt",
  "followUpAt",
  "remarks",
] as const;

export type SalesSuburbWorkshopAgentContactWritableRow = {
  tenant_id: string;
  workshop_id: string;
  agent_id: string;
  call_status: string | null;
  first_called_at: string | null;
  follow_up_at: string | null;
  remarks: string;
};

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function nullableStringField(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value.trim() || null : undefined;
}

function optionalStringField(value: unknown): string | undefined {
  if (value === null) return "";
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

function readNullableStringAlias(
  input: Record<string, unknown>,
  camel: string,
  snake: string
): string | null | undefined {
  const camelValue = nullableStringField(input[camel]);
  if (camelValue !== undefined) return camelValue;
  return nullableStringField(input[snake]);
}

function readOptionalStringAlias(
  input: Record<string, unknown>,
  camel: string,
  snake: string
): string | undefined {
  const camelValue = optionalStringField(input[camel]);
  if (camelValue !== undefined) return camelValue;
  return optionalStringField(input[snake]);
}

export function toSalesSuburbWorkshopAgentContactInsertRow(
  input: SalesSuburbWorkshopAgentContactInput
): SalesSuburbWorkshopAgentContactWritableRow {
  const source = input as Record<string, unknown>;
  return {
    tenant_id: readStringAlias(source, "tenantId", "tenant_id") ?? "",
    workshop_id: readStringAlias(source, "workshopId", "workshop_id") ?? "",
    agent_id: readStringAlias(source, "agentId", "agent_id") ?? "",
    call_status: readNullableStringAlias(source, "callStatus", "call_status") ?? null,
    first_called_at:
      readNullableStringAlias(source, "firstCalledAt", "first_called_at") ?? null,
    follow_up_at:
      readNullableStringAlias(source, "followUpAt", "follow_up_at") ?? null,
    remarks: readOptionalStringAlias(source, "remarks", "remarks") ?? "",
  };
}

export function toSalesSuburbWorkshopAgentContactUpdatePatch(
  input: SalesSuburbWorkshopAgentContactUpdateInput
): Partial<SalesSuburbWorkshopAgentContactWritableRow> | null {
  const source = input as Record<string, unknown>;
  const patch: Partial<SalesSuburbWorkshopAgentContactWritableRow> = {};

  const tenantId = readStringAlias(source, "tenantId", "tenant_id");
  if (tenantId !== undefined) patch.tenant_id = tenantId;

  const workshopId = readStringAlias(source, "workshopId", "workshop_id");
  if (workshopId !== undefined) patch.workshop_id = workshopId;

  const agentId = readStringAlias(source, "agentId", "agent_id");
  if (agentId !== undefined) patch.agent_id = agentId;

  const callStatus = readNullableStringAlias(source, "callStatus", "call_status");
  if (callStatus !== undefined) patch.call_status = callStatus;

  const firstCalledAt = readNullableStringAlias(
    source,
    "firstCalledAt",
    "first_called_at"
  );
  if (firstCalledAt !== undefined) patch.first_called_at = firstCalledAt;

  const followUpAt = readNullableStringAlias(source, "followUpAt", "follow_up_at");
  if (followUpAt !== undefined) patch.follow_up_at = followUpAt;

  const remarks = readOptionalStringAlias(source, "remarks", "remarks");
  if (remarks !== undefined) patch.remarks = remarks;

  return Object.keys(patch).length > 0 ? patch : null;
}
