import { createSupabaseClient, getSupabaseProjectUrl, getSupabaseServiceRoleKey } from "../../db/supabase/supabase.client.js";
import { getDidMappingByDid } from "../did-mappings.service.js";
import { provisionBlackAiAgent } from "./black-ai-agent-provisioning.service.js";
import { createOnboardingService, OnboardingError, type OnboardingRecord, type OnboardingRepository } from "./onboarding.service.js";
import { roleMayRegisterAgents } from "../../config/supabase-app-role.js";
import { provisionBlackBusiness } from "./black-business-provisioning.service.js";
import { provisionTradeBusiness } from "./trade-business-provisioning.service.js";

function database() {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) throw new OnboardingError(503, "STORAGE_UNAVAILABLE", "Onboarding storage is not configured.");
  return createSupabaseClient(url, key);
}
function storageError(error: { code?: string } | null) {
  if (error) throw new OnboardingError(503, "STORAGE_UNAVAILABLE", "Onboarding storage is unavailable. Verify the onboarding SQL migration and database connection.");
}

const repository: OnboardingRepository = {
  async get(id) {
    const { data, error } = await database().from("ai_onboarding_drafts").select("*").eq("id", id).maybeSingle();
    storageError(error);
    return data as OnboardingRecord | null;
  },
  async insert(record) {
    const { data, error } = await database().from("ai_onboarding_drafts").insert(record).select("*").single();
    if (error?.code === "23505") return null;
    storageError(error);
    return data as OnboardingRecord;
  },
  async replace(previous, next) {
    const { data, error } = await database().from("ai_onboarding_drafts").update(next)
      .eq("id", previous.id).eq("operator_id", previous.operator_id).eq("version", previous.version).select("*").maybeSingle();
    storageError(error);
    return data as OnboardingRecord | null;
  },
};

export const onboardingService = createOnboardingService({ repository, getMapping: getDidMappingByDid, provision: provisionBlackAiAgent, provisionBlackBusiness, provisionTradeBusiness });

/** Voice sessions use a nominated existing platform operator, not a caller-selected principal. */
export async function assertVoiceOnboardingOperator(operatorId: string): Promise<void> {
  const client = database();
  const [identity, roles] = await Promise.all([
    client.auth.admin.getUserById(operatorId),
    client.from("user_roles").select("role").eq("user_id", operatorId),
  ]);
  const user = identity.data.user;
  const bannedUntil = (user as { banned_until?: string } | null)?.banned_until;
  if (identity.error || roles.error || !user || (bannedUntil && Date.parse(bannedUntil) > Date.now()) ||
      !(roles.data ?? []).some((row: { role: string }) => roleMayRegisterAgents(row.role))) {
    throw new OnboardingError(403, "OPERATOR_UNAVAILABLE", "The platform onboarding operator is unavailable. Route to staff.");
  }
}
