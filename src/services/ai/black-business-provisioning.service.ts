import { blackEndpoint } from "../../config/black-api.js";
import { z } from "zod";
import { OnboardingError, type OnboardingDependencies } from "./onboarding.service.js";

const resultSchema = z.object({ status: z.literal("TEST_MODE"), ownerUid: z.string().min(1), branchId: z.string().min(1),
  serviceIds: z.array(z.string()), staffIds: z.array(z.string()), created: z.boolean() });
export const provisionBlackBusiness: NonNullable<OnboardingDependencies["provisionBlackBusiness"]> = async input => {
  const secret = process.env.BLACK_ONBOARDING_SECRET?.trim() ?? "";
  if (secret.length < 32 || secret === process.env.AI_ONBOARDING_BRIDGE_SECRET?.trim() || secret === process.env.AI_VOICE_BRIDGE_SECRET?.trim()) {
    throw new OnboardingError(503, "BLACK_SETUP_UNAVAILABLE", "Configure a separate Black provisioning service credential.");
  }
  const response = await fetch(blackEndpoint("/api/command-centre/onboarding"), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, ...input }),
  });
  if (!response.ok) throw new OnboardingError(502, "BLACK_SETUP_FAILED", "Black setup did not complete. Reconcile its provisioning checkpoint before retrying.");
  let result: z.infer<typeof resultSchema>;
  try { result = resultSchema.parse(await response.json()); }
  catch { throw new OnboardingError(502, "BLACK_SETUP_FAILED", "Black returned an invalid provisioning result. Reconcile its checkpoint before retrying."); }
  if (result.ownerUid !== input.approval.ownerUid || result.serviceIds.length !== (input.configuration.services ?? []).length || result.staffIds.length !== (input.configuration.staff ?? []).length) {
    throw new OnboardingError(502, "BLACK_SETUP_FAILED", "Black's result does not match the approved setup. Reconcile its checkpoint before retrying.");
  }
  return result;
};
