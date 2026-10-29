import { getDidMappingByDid } from "../did-mappings.service.js";
import type { DidMappingRow } from "../../types/did-mapping.types.js";
import { createSupabaseClient, getSupabaseProjectUrl, getSupabaseServiceRoleKey } from "../../db/supabase/supabase.client.js";

type QueueRoute = { id: string; name: string | null; type: string | null; tenant_id: string };
type MappingLookup = (did: string) => Promise<DidMappingRow | null>;
type QueueLookup = (queueId: string, tenantId: string) => Promise<QueueRoute | null>;

async function getQueueRoute(queueId: string, tenantId: string): Promise<QueueRoute | null> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) throw new Error("Supabase service credentials are unavailable.");
  const { data, error } = await createSupabaseClient(url, key)
    .from("queues")
    .select("id,name,type,tenant_id")
    .eq("id", queueId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error("Queue route lookup failed.");
  return data as QueueRoute | null;
}

function hasProductToken(value: unknown, product: string): boolean {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).includes(product);
}

/** Resolve product from the same queue identity used by the admin panel's queue routing. */
export async function resolveVoiceProductForDid(
  did: string,
  lookup: MappingLookup = getDidMappingByDid,
  queueLookup: QueueLookup = getQueueRoute,
): Promise<{ brand: "black" | "trade" | "pink"; did: string }> {
  if (!/^\d{6,15}$/.test(did)) throw new Error("Invalid DID.");
  const mappings = (await Promise.all([lookup(did), lookup(`+${did}`)])).filter((row): row is DidMappingRow => row !== null);
  if (mappings.length !== 1) throw new Error("DID mapping is missing or ambiguous.");
  const mapping = mappings[0]!;
  if (!mapping.tenant_id || !mapping.queue_id || !mapping.owner_id) throw new Error("DID mapping is incomplete.");
  const queue = await queueLookup(mapping.queue_id, mapping.tenant_id);
  if (!queue || queue.tenant_id !== mapping.tenant_id) throw new Error("DID queue mapping is invalid.");
  if ([queue.id, queue.name, queue.type].some(value => hasProductToken(value, "pink"))) {
    if (!mapping.branch_id?.trim()) throw new Error("Pink DID mapping requires a branch.");
    return { brand: "pink", did };
  }
  if ([queue.id, queue.name, queue.type].some(value => hasProductToken(value, "blue"))) {
    if (mapping.branch_id?.trim()) throw new Error("Blue DID mapping must not include a Black branch.");
    return { brand: "trade", did };
  }
  if (!mapping.branch_id?.trim()) throw new Error("Black DID mapping requires a branch.");
  return { brand: "black", did };
}
