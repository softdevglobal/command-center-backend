/** Row shape for `public.did_mappings`. */
export type DidMappingRow = {
  did: string;
  tenant_id: string;
  queue_id: string;
  label: string;
  branch_id: string | null;
  branch_name: string | null;
  owner_id: string | null;
  workshop_name: string | null;
};

/** POST /api/did-mappings body (camelCase). */
export type DIDMappingInput = {
  did: string;
  label: string;
  tenantId: string;
  queueId: string;
  ownerUid: string;
  workshopName: string;
  branchId: string;
  branchName: string;
};

/** @deprecated Use DIDMappingInput */
export type CreateDidMappingBody = DIDMappingInput;

export function toDidMappingRow(input: DIDMappingInput) {
  return {
    did: input.did.trim(),
    label: input.label.trim(),
    tenant_id: input.tenantId,
    queue_id: input.queueId,
    owner_id: input.ownerUid,
    workshop_name: input.workshopName,
    branch_id: input.branchId,
    branch_name: input.branchName,
  };
}

/** PATCH /api/did-mappings/:did — send one or more fields; `did` is fixed in the URL. */
export type DIDMappingUpdateInput = {
  label?: string;
  tenantId?: string;
  queueId?: string;
  ownerUid?: string;
  workshopName?: string;
  branchId?: string;
  branchName?: string;
};

const PATCHABLE_FIELDS = [
  "label",
  "tenantId",
  "queueId",
  "ownerUid",
  "workshopName",
  "branchId",
  "branchName",
] as const;

/** Builds a Supabase patch with only fields present on the request body. */
export function toDidMappingUpdatePatch(
  input: DIDMappingUpdateInput
): Record<string, string> | null {
  const patch: Record<string, string> = {};

  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.tenantId !== undefined) patch.tenant_id = String(input.tenantId).trim();
  if (input.queueId !== undefined) patch.queue_id = String(input.queueId).trim();
  if (input.ownerUid !== undefined) patch.owner_id = String(input.ownerUid);
  if (input.workshopName !== undefined) {
    patch.workshop_name = String(input.workshopName);
  }
  if (input.branchId !== undefined) patch.branch_id = String(input.branchId);
  if (input.branchName !== undefined) patch.branch_name = String(input.branchName);

  return Object.keys(patch).length > 0 ? patch : null;
}

export { PATCHABLE_FIELDS };
