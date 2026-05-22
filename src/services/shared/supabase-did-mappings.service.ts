import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../../db/supabase/supabase.client.js";

import {
  PATCHABLE_FIELDS,
  toDidMappingRow,
  toDidMappingUpdatePatch,
  type DIDMappingInput,
  type DIDMappingUpdateInput,
  type DidMappingRow,
} from "../../types/did-mapping.types.js";

function throwDidMappingDbError(error: { code?: string; message: string }): never {
  const fk =
    error.code === "23503" ||
    /foreign key|violates foreign key/i.test(error.message);
  if (fk) {
    const e = new Error(
      "Invalid tenantId or queueId — referenced row does not exist."
    );
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }
  throw new Error(error.message);
}

function adminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createSupabaseClient(supabaseUrl, serviceRoleKey);
}

export async function listDidMappingsInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  filters: { tenantId?: string; queueId?: string };
}): Promise<DidMappingRow[]> {
  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  let q = supabase.from("did_mappings").select("*").order("did", {
    ascending: true,
  });
  const tenantId = input.filters.tenantId?.trim();
  const queueId = input.filters.queueId?.trim();
  if (tenantId) q = q.eq("tenant_id", tenantId);
  if (queueId) q = q.eq("queue_id", queueId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as DidMappingRow[];
}

export async function getDidMappingByDidInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  did: string;
}): Promise<DidMappingRow | null> {
  const key = input.did.trim();
  if (!key) return null;

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("did_mappings")
    .select("*")
    .eq("did", key)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as DidMappingRow | null) ?? null;
}

export async function createDidMappingInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  body: DIDMappingInput;
}): Promise<DidMappingRow> {
  const body = input.body;

  if (
    body?.did === undefined ||
    body?.label === undefined ||
    body?.tenantId === undefined ||
    body?.queueId === undefined ||
    body?.ownerUid === undefined ||
    body?.workshopName === undefined ||
    body?.branchId === undefined ||
    body?.branchName === undefined
  ) {
    throw new Error(
      "did, label, tenantId, queueId, ownerUid, workshopName, branchId, and branchName are required."
    );
  }

  const row = toDidMappingRow(body);

  if (!row.did || !row.tenant_id || !row.queue_id) {
    throw new Error("did, tenantId, and queueId must be non-empty after trim.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("did_mappings")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    const dup = error.code === "23505" || /duplicate key/i.test(error.message);
    if (dup) {
      const e = new Error(`DID already mapped: ${row.did}`);
      (e as Error & { statusCode?: number }).statusCode = 409;
      throw e;
    }
    throwDidMappingDbError(error);
  }

  return data as DidMappingRow;
}

export async function updateDidMappingInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  did: string;
  body: DIDMappingUpdateInput;
}): Promise<DidMappingRow> {
  const key = input.did.trim();
  if (!key) {
    const e = new Error("did is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const patch = toDidMappingUpdatePatch(input.body);
  if (!patch) {
    throw new Error(
      `Provide at least one field to update: ${PATCHABLE_FIELDS.join(", ")}.`
    );
  }

  if (patch.label !== undefined && !patch.label) {
    throw new Error("label cannot be empty.");
  }
  if (patch.tenant_id !== undefined && !patch.tenant_id) {
    throw new Error("tenantId cannot be empty.");
  }
  if (patch.queue_id !== undefined && !patch.queue_id) {
    throw new Error("queueId cannot be empty.");
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("did_mappings")
    .update(patch)
    .eq("did", key)
    .select("*")
    .maybeSingle();

  if (error) throwDidMappingDbError(error);
  if (!data) {
    const e = new Error("DID mapping not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as DidMappingRow;
}

export async function deleteDidMappingInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  did: string;
}): Promise<DidMappingRow> {
  const key = input.did.trim();
  if (!key) {
    const e = new Error("did is required.");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const supabase = adminClient(input.supabaseUrl, input.serviceRoleKey);
  const { data, error } = await supabase
    .from("did_mappings")
    .delete()
    .eq("did", key)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    const e = new Error("DID mapping not found.");
    (e as Error & { statusCode?: number }).statusCode = 404;
    throw e;
  }

  return data as DidMappingRow;
}
