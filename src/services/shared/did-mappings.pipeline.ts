import type {
  DIDMappingInput,
  DIDMappingUpdateInput,
  DidMappingRow,
} from "../../types/did-mapping.types.js";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../../db/supabase/supabase.client.js";
import {
  createDidMappingInSupabase,
  deleteDidMappingInSupabase,
  getDidMappingByDidInSupabase,
  listDidMappingsInSupabase,
  updateDidMappingInSupabase,
} from "./supabase-did-mappings.service.js";

function assertSupabaseForDidMappings(): {
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
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for DID mapping APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

/** Supabase only — `public.did_mappings`. */
export async function listDidMappingsViaSupabase(input: {
  filters: { tenantId?: string; queueId?: string };
}): Promise<DidMappingRow[]> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForDidMappings();
  return listDidMappingsInSupabase({
    supabaseUrl,
    serviceRoleKey,
    filters: input.filters,
  });
}

export async function getDidMappingByDidViaSupabase(input: {
  did: string;
}): Promise<DidMappingRow | null> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForDidMappings();
  return getDidMappingByDidInSupabase({
    supabaseUrl,
    serviceRoleKey,
    did: input.did,
  });
}

export async function createDidMappingViaSupabase(input: {
  body: DIDMappingInput;
}): Promise<DidMappingRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForDidMappings();
  return createDidMappingInSupabase({
    supabaseUrl,
    serviceRoleKey,
    body: input.body,
  });
}

export async function deleteDidMappingViaSupabase(input: {
  did: string;
}): Promise<DidMappingRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForDidMappings();
  return deleteDidMappingInSupabase({
    supabaseUrl,
    serviceRoleKey,
    did: input.did,
  });
}

export async function updateDidMappingViaSupabase(input: {
  did: string;
  body: DIDMappingUpdateInput;
}): Promise<DidMappingRow> {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForDidMappings();
  return updateDidMappingInSupabase({
    supabaseUrl,
    serviceRoleKey,
    did: input.did,
    body: input.body,
  });
}
