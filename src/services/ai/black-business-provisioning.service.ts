import { blackEndpoint } from "../../config/black-api.js";
import { z } from "zod";
import { OnboardingError, type OnboardingDependencies } from "./onboarding.service.js";

const resultSchema = z.object({ status: z.literal("TEST_MODE"), ownerUid: z.string().min(1), branchId: z.string().min(1).nullable(),
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
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { code?: unknown } | null;
    const rawCode = typeof payload?.code === "string" ? payload.code.toUpperCase() : `HTTP_${response.status}`;
    const safeCode = /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : `HTTP_${response.status}`;
    console.warn("[black-onboarding] Black rejected provisioning", { requestId: input.requestId, status: response.status, code: safeCode });
    throw new OnboardingError(502, `BLACK_SETUP_${safeCode}`, "Black rejected the setup. Check its onboarding checkpoint before retrying.");
  }
  let result: z.infer<typeof resultSchema>;
  try { result = resultSchema.parse(await response.json()); }
  catch {
    console.warn("[black-onboarding] Black returned an invalid provisioning result", { requestId: input.requestId });
    throw new OnboardingError(502, "BLACK_SETUP_INVALID_RESPONSE", "Black returned an invalid provisioning result. Check its onboarding checkpoint before retrying.");
  }
  if (result.ownerUid !== input.approval.ownerUid || result.serviceIds.length !== 0 || result.staffIds.length !== 0) {
    console.warn("[black-onboarding] Black result did not match the request", { requestId: input.requestId, ownerMatched: result.ownerUid === input.approval.ownerUid, serviceCount: result.serviceIds.length, staffCount: result.staffIds.length });
    throw new OnboardingError(502, "BLACK_SETUP_RESULT_MISMATCH", "Black's result does not match this setup. Check its onboarding checkpoint before retrying.");
  }
  return result;
};
