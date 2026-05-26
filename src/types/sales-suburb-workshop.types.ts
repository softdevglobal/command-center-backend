/** Row shape for `public.sales_suburb_workshops`. */
export type SalesSuburbWorkshopRow = {
  id: string;
  tenant_id: string;
  suburb: string;
  suburb_normalized: string;
  workshop_name: string;
  phone_number: string;
  owner_name: string;
  owner_email: string;
  location: string;
  website: string;
  created_at: string;
  updated_at: string;
};

/** POST /api/sales-suburb-workshops body (camelCase). */
export type SalesSuburbWorkshopInput = {
  tenantId?: string;
  suburb: string;
  workshopName?: string;
  phoneNumber?: string;
  ownerName?: string;
  ownerEmail?: string;
  location?: string;
  website?: string;
};

/** PATCH /api/sales-suburb-workshops/:id body. */
export type SalesSuburbWorkshopUpdateInput = Partial<SalesSuburbWorkshopInput>;

export type SalesSuburbWorkshopListFilters = {
  tenantId?: string;
  suburb?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type SalesSuburbWorkshopListResult = {
  data: SalesSuburbWorkshopRow[];
  total: number;
  limit: number;
  offset: number;
};

export type SalesSuburbWorkshopAssignedListInput = {
  agentId: string;
  filters: SalesSuburbWorkshopListFilters;
};

export const SALES_SUBURB_WORKSHOP_PATCHABLE_FIELDS = [
  "tenantId",
  "suburb",
  "workshopName",
  "phoneNumber",
  "ownerName",
  "ownerEmail",
  "location",
  "website",
] as const;

type SalesSuburbWorkshopWritableRow = {
  tenant_id: string;
  suburb: string;
  workshop_name: string;
  phone_number: string;
  owner_name: string;
  owner_email: string;
  location: string;
  website: string;
};

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
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

function readOptionalStringAlias(
  input: Record<string, unknown>,
  camel: string,
  snake: string
): string | undefined {
  const camelValue = optionalStringField(input[camel]);
  if (camelValue !== undefined) return camelValue;
  return optionalStringField(input[snake]);
}

export function toSalesSuburbWorkshopInsertRow(
  input: SalesSuburbWorkshopInput
): SalesSuburbWorkshopWritableRow {
  const source = input as Record<string, unknown>;
  return {
    tenant_id: readStringAlias(source, "tenantId", "tenant_id") ?? "",
    suburb: readStringAlias(source, "suburb", "suburb") ?? "",
    workshop_name:
      readOptionalStringAlias(source, "workshopName", "workshop_name") ?? "",
    phone_number:
      readOptionalStringAlias(source, "phoneNumber", "phone_number") ?? "",
    owner_name: readOptionalStringAlias(source, "ownerName", "owner_name") ?? "",
    owner_email:
      readOptionalStringAlias(source, "ownerEmail", "owner_email") ?? "",
    location: readOptionalStringAlias(source, "location", "location") ?? "",
    website: readOptionalStringAlias(source, "website", "website") ?? "",
  };
}

export function toSalesSuburbWorkshopUpdatePatch(
  input: SalesSuburbWorkshopUpdateInput
): Partial<SalesSuburbWorkshopWritableRow> | null {
  const source = input as Record<string, unknown>;
  const patch: Partial<SalesSuburbWorkshopWritableRow> = {};

  const tenantId = readStringAlias(source, "tenantId", "tenant_id");
  if (tenantId !== undefined) patch.tenant_id = tenantId;

  const suburb = readStringAlias(source, "suburb", "suburb");
  if (suburb !== undefined) patch.suburb = suburb;

  const workshopName = readOptionalStringAlias(
    source,
    "workshopName",
    "workshop_name"
  );
  if (workshopName !== undefined) patch.workshop_name = workshopName;

  const phoneNumber = readOptionalStringAlias(
    source,
    "phoneNumber",
    "phone_number"
  );
  if (phoneNumber !== undefined) patch.phone_number = phoneNumber;

  const ownerName = readOptionalStringAlias(source, "ownerName", "owner_name");
  if (ownerName !== undefined) patch.owner_name = ownerName;

  const ownerEmail = readOptionalStringAlias(
    source,
    "ownerEmail",
    "owner_email"
  );
  if (ownerEmail !== undefined) patch.owner_email = ownerEmail;

  const location = readOptionalStringAlias(source, "location", "location");
  if (location !== undefined) patch.location = location;

  const website = readOptionalStringAlias(source, "website", "website");
  if (website !== undefined) patch.website = website;

  return Object.keys(patch).length > 0 ? patch : null;
}
