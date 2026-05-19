import type {
  DIDMappingInput,
  DIDMappingUpdateInput,
  DidMappingRow,
} from "../types/did-mapping.types.js";
import {
  createDidMappingViaSupabase,
  deleteDidMappingViaSupabase,
  getDidMappingByDidViaSupabase,
  listDidMappingsViaSupabase,
  updateDidMappingViaSupabase,
} from "./shared/did-mappings.pipeline.js";

/** Supabase `did_mappings` — service role via pipeline (same env as agent registration). */
export async function listDidMappings(filters: {
  tenantId?: string;
  queueId?: string;
}): Promise<DidMappingRow[]> {
  return listDidMappingsViaSupabase({ filters });
}

export async function getDidMappingByDid(did: string): Promise<DidMappingRow | null> {
  return getDidMappingByDidViaSupabase({ did });
}

export async function createDidMapping(
  body: DIDMappingInput
): Promise<DidMappingRow> {
  return createDidMappingViaSupabase({ body });
}

export async function deleteDidMapping(did: string): Promise<DidMappingRow> {
  return deleteDidMappingViaSupabase({ did });
}

export async function updateDidMapping(
  did: string,
  body: DIDMappingUpdateInput
): Promise<DidMappingRow> {
  return updateDidMappingViaSupabase({ did, body });
}
