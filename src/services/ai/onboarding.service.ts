import { createHash } from "node:crypto";
import type { DidMappingRow } from "../../types/did-mapping.types.js";
import type { BlackAiAgentProvisioningInput } from "../bms_black/ai-reception.service.js";
import { blackAdminEndpoint, blackEndpoint } from "../../config/black-api.js";
import { tradeOwnerReviewUrl, type TradeBusinessResult } from "./trade-business-provisioning.service.js";
import { pinkOnboardingLoginUrl, type PinkBusinessResult } from "../bms_pink/pink-onboarding.service.js";
import type { ReviewNotice, ReviewNotifications } from "./onboarding-review-notification.service.js";
import {
  missingOnboardingInformation, saveOnboardingArguments, onboardingVersionArguments, ownerApprovalArguments,
  type OnboardingConfiguration, type SaveOnboardingArguments, type OnboardingVersionArguments, type OwnerApprovalArguments,
} from "./onboarding.schemas.js";

export class OnboardingError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export type ExistingOnboardingBinding = { did: string; tenantId: string; ownerUid: string; branchId: string; queueId: string };
export type OnboardingBinding = ExistingOnboardingBinding | { kind: "new_business"; ownerEmail: string };
export type OnboardingApproval = { ownerUid: string; reviewedVersion: number; termsVersion: string; approvedAt: string; configurationHash?: string; method?: "phone_confirmation" };
export type BlackBusinessResult = { status: "TEST_MODE"; ownerUid: string; branchId: string | null; serviceIds: string[]; staffIds: string[]; created: boolean };
export type OnboardingProvisioningResult = { firebaseBlackUid: string; did: string; name: string; created: boolean } | BlackBusinessResult | TradeBusinessResult | PinkBusinessResult;
export type OwnerIdentity = { uid: string; email?: string | null; emailVerified?: boolean };
export type OnboardingRecord = {
  id: string;
  operator_id: string;
  version: number;
  status: "draft" | "owner_review" | "approved" | "provisioning" | "provisioning_failed" | "provisioned";
  configuration: OnboardingConfiguration;
  configuration_hash: string;
  binding: OnboardingBinding | null;
  approval: OnboardingApproval | null;
  provisioning_result: OnboardingProvisioningResult | null;
  updated_at: string;
  updated_by: string;
  last_action: string;
};
export interface OnboardingRepository {
  get(id: string): Promise<OnboardingRecord | null>;
  insert(record: OnboardingRecord): Promise<OnboardingRecord | null>;
  replace(previous: OnboardingRecord, next: OnboardingRecord): Promise<OnboardingRecord | null>;
}
export type OnboardingDependencies = {
  repository: OnboardingRepository;
  getMapping(did: string): Promise<DidMappingRow | null>;
  provision(input: BlackAiAgentProvisioningInput): Promise<OnboardingProvisioningResult>;
  provisionBlackBusiness?(input: { requestId: string; configuration: OnboardingConfiguration; configurationHash: string; approval: OnboardingApproval }): Promise<BlackBusinessResult>;
  provisionTradeBusiness?(input: { requestId: string; configuration: OnboardingConfiguration; configurationHash: string; approval: OnboardingApproval }): Promise<TradeBusinessResult>;
  provisionPinkBusiness?(input: { requestId: string; configuration: OnboardingConfiguration; configurationHash: string; approval: OnboardingApproval }): Promise<PinkBusinessResult>;
  notifyOwnerReview?(input: ReviewNotice): Promise<ReviewNotifications>;
  getReviewNotifications?(input: Pick<ReviewNotice, "draftId" | "configurationHash">): Promise<ReviewNotifications>;
  prepareOwnerAccount?(input: { draftId: string; configuration: OnboardingConfiguration }): Promise<{ uid: string; loginUrl: string }>;
  notifyAccountSetup?(input: { draftId: string; configurationHash: string; configuration: OnboardingConfiguration; ownerUid: string }): Promise<ReviewNotifications>;
  getAccountNotifications?(input: Pick<ReviewNotice, "draftId" | "configurationHash">): Promise<ReviewNotifications>;
  now?: () => Date;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function configurationHash(config: OnboardingConfiguration): string {
  return createHash("sha256").update(canonical(config)).digest("hex");
}

function accountSetupFailureDetails(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause as Record<string, unknown> : {};
  const safeCode = (input: unknown) => typeof input === "string" && /^[A-Za-z0-9_./-]{1,100}$/.test(input) ? input : undefined;
  const message = typeof value.message === "string" ? value.message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240) : undefined;
  return {
    name: typeof value.name === "string" ? value.name.slice(0, 80) : "UnknownError",
    ...(safeCode(value.code) ? { code: safeCode(value.code) } : {}),
    ...(safeCode(cause.code) ? { causeCode: safeCode(cause.code) } : {}),
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    ...(message ? { message } : {}),
  };
}

/** HTTP and MCP share this service. Principal IDs are supplied by authentication, never by tool arguments. */
export function createOnboardingService(deps: OnboardingDependencies) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const conflict = () => new OnboardingError(409, "VERSION_CONFLICT", "The draft changed. Read its current status before retrying.");
  async function getOwned(draftId: string, operatorId: string) {
    const row = await deps.repository.get(draftId);
    if (!row || row.operator_id !== operatorId) throw new OnboardingError(404, "NOT_FOUND", "Onboarding draft not found.");
    return row;
  }
  async function change(row: OnboardingRecord, actor: string, action: string, patch: Partial<OnboardingRecord>) {
    const result = await deps.repository.replace(row, { ...row, ...patch, version: row.version + 1, updated_at: now(), updated_by: actor, last_action: action });
    if (!result) throw conflict();
    return result;
  }
  async function resolveBinding(config: OnboardingConfiguration): Promise<OnboardingBinding> {
    if (config.setupMode === "new_business") return { kind: "new_business", ownerEmail: config.business!.ownerEmail!.toLowerCase() };
    const mapping = config.did ? await deps.getMapping(config.did) : null;
    if (!mapping?.tenant_id || !mapping.owner_id || !mapping.branch_id || !mapping.queue_id) {
      throw new OnboardingError(422, "MAPPING_REQUIRED", "Configure an existing Black business, branch, phone number and staff fallback before owner review.");
    }
    return { did: mapping.did, tenantId: mapping.tenant_id, ownerUid: mapping.owner_id, branchId: mapping.branch_id, queueId: mapping.queue_id };
  }
  function ownerMatches(row: OnboardingRecord, identity: OwnerIdentity) {
    if (!row.binding) return false;
    return "kind" in row.binding
      ? identity.emailVerified === true && identity.email?.toLowerCase() === row.binding.ownerEmail
      : row.binding.ownerUid === identity.uid;
  }
  async function assertBinding(row: OnboardingRecord) {
    if (!row.binding || canonical(await resolveBinding(row.configuration)) !== canonical(row.binding)) {
      throw new OnboardingError(409, "MAPPING_CHANGED", "The business phone assignment changed. Save the draft and obtain a new owner approval.");
    }
  }
  function status(row: OnboardingRecord) {
    return {
      draftId: row.id, version: row.version, status: row.status, configuration: row.configuration,
      configurationHash: row.configuration_hash, missingInformation: missingOnboardingInformation(row.configuration),
      binding: row.binding, approval: row.approval, provisioningResult: row.provisioning_result,
      updatedAt: row.updated_at, liveCallsActivated: false,
      reviewNotifications: null as ReviewNotifications | null,
      accountNotifications: null as ReviewNotifications | null,
      loginUrl: row.status === "provisioned" && row.approval?.method === "phone_confirmation"
        ? row.configuration.product === "pink" ? pinkOnboardingLoginUrl() : row.configuration.product === "trade" ? `${(process.env.TRADE_ADMIN_BASE_URL?.trim() || "https://trade.bmspros.com.au").replace(/\/+$/, "")}/login` : blackAdminEndpoint("/login") : null,
      ownerReviewUrl: row.configuration.product !== "pink" && row.status !== "draft" && row.approval?.method !== "phone_confirmation" ? row.configuration.product === "trade" ? tradeOwnerReviewUrl(row.id) : blackEndpoint(`/onboarding/${row.id}`) : null,
      nextAction: row.status === "provisioned" ? row.configuration.product === "trade"
          ? "The Trade business is pending review. Select a subscription plan, complete billing authorization, confirm service setup and approve launch before activating the account."
          : "Complete billing authorization, staff invitations, approved runtime settings and phone routing; run pilot checks and obtain launch approval."
        : row.status === "owner_review" ? `The ${row.configuration.product === "pink" ? "Pink" : row.configuration.product === "trade" ? "Trade" : "Black"} business owner must sign in, verify their email and approve this exact setup.`
        : row.status === "approved" || row.status === "provisioning_failed" ? `Provision the approved ${row.configuration.product === "pink" ? "Pink" : row.configuration.product === "trade" ? "Trade" : "Black"} business setup.`
        : row.status === "provisioning" ? "Provisioning is in progress; check status before retrying."
        : row.configuration.product === "pink" ? "Complete the Pink signup details, read them back and obtain explicit permission before completing account creation."
        : "Complete the missing information and submit for owner review.",
    };
  }
  async function reviewStatus(row: OnboardingRecord, send: boolean) {
    if (row.approval?.method === "phone_confirmation") return accountStatus(row, false);
    const result = status(row);
    if (!result.ownerReviewUrl || !["black", "trade"].includes(row.configuration.product ?? "")) return result;
    try {
      const key = { draftId: row.id, configurationHash: row.configuration_hash };
      result.reviewNotifications = send && deps.notifyOwnerReview
        ? await deps.notifyOwnerReview({ ...key, reviewUrl: result.ownerReviewUrl,
          ownerEmail: row.configuration.business?.ownerEmail ?? "", ownerPhone: row.configuration.business?.ownerPhone ?? "" })
        : await deps.getReviewNotifications?.(key) ?? null;
    } catch {
      result.reviewNotifications = { sms: { status: "storage_unavailable" }, email: { status: "storage_unavailable" } };
    }
    return result;
  }
  async function accountStatus(row: OnboardingRecord, send: boolean) {
    const result = status(row);
    if (row.status !== "provisioned" || !row.approval) return result;
    result.nextAction = row.configuration.product === "black"
      ? "Use the private password-setup link sent by email to set a password, then sign in to the Black dashboard and complete the business profile, branch, services, prices, staff and schedules. The selected plan remains pending until checkout is completed in the dashboard. No separate owner review or email-verification step is required."
      : "Use the private password-setup link sent by SMS/email to set a password, then sign in to the dashboard. No separate owner review or email-verification step is required. Plan, billing and launch requirements remain separate.";
    try {
      const key = { draftId: row.id, configurationHash: row.configuration_hash };
      result.accountNotifications = send && deps.notifyAccountSetup
        ? await deps.notifyAccountSetup({ ...key, configuration: row.configuration, ownerUid: row.approval.ownerUid })
        : await deps.getAccountNotifications?.(key) ?? null;
    } catch (error) {
      const code = error instanceof OnboardingError ? error.code : "ACCOUNT_NOTIFICATION_FAILED";
      result.accountNotifications = { sms: { status: "storage_unavailable", code }, email: { status: "storage_unavailable", code } };
    }
    return result;
  }
  return {
    async completeBusinessOnboarding(operatorId: string, raw: OnboardingVersionArguments) {
      const input = onboardingVersionArguments.parse(raw);
      const row = await getOwned(input.draftId, operatorId);
      if (row.version !== input.expectedVersion) throw conflict();
      if (row.configuration.setupMode !== "new_business" || !["black", "trade", "pink"].includes(row.configuration.product ?? ""))
        throw new OnboardingError(422, "NEW_BUSINESS_REQUIRED", "This flow creates a new Black, Trade or Pink business account only.");
      if (row.status === "provisioned") {
        if (row.approval?.method !== "phone_confirmation") throw new OnboardingError(409, "LEGACY_SETUP", "This account used the earlier owner-review flow. Use its existing login.");
        return accountStatus(row, true);
      }
      const stale = row.status === "provisioning" && Date.parse(now()) - Date.parse(row.updated_at) > 5 * 60 * 1000;
      if (!["draft", "owner_review", "provisioning_failed"].includes(row.status) && !stale)
        throw new OnboardingError(409, "INVALID_STATE", "Account creation is already in progress. Check status before retrying.");
      const missing = missingOnboardingInformation(row.configuration);
      if (missing.length) throw new OnboardingError(422, "INCOMPLETE_SETUP", `Complete these fields before account creation: ${missing.join(", ")}.`);
      if (!deps.prepareOwnerAccount) throw new OnboardingError(503, "ACCOUNT_SETUP_UNAVAILABLE", "Account creation is unavailable.");
      const ownerUid = `ai-owner-${row.id.replace(/-/g, "")}`;
      let claimed = await change(row, operatorId, "account_creation_started", {
        status: "provisioning", binding: await resolveBinding(row.configuration),
        approval: { ownerUid, reviewedVersion: row.version, termsVersion: row.configuration.terms!.version, approvedAt: now(), configurationHash: row.configuration_hash, method: "phone_confirmation" },
      });
      let stage = "OWNER_AUTH";
      try {
        const account = await deps.prepareOwnerAccount({ draftId: row.id, configuration: row.configuration });
        if (account.uid !== `ai-owner-${row.id.replace(/-/g, "")}`) throw new OnboardingError(409, "ACCOUNT_IDENTITY_CHANGED", "The account does not belong to this onboarding request.");
        stage = "CALL_CONFIRMATION_CHECKPOINT";
        claimed = await change(claimed, operatorId, "caller_confirmed_account_setup", { approval: { ownerUid: account.uid, reviewedVersion: row.version,
          termsVersion: row.configuration.terms!.version, approvedAt: now(), configurationHash: row.configuration_hash, method: "phone_confirmation" } });
        const provision = row.configuration.product === "pink" ? deps.provisionPinkBusiness : row.configuration.product === "trade" ? deps.provisionTradeBusiness : deps.provisionBlackBusiness;
        if (!provision) throw new OnboardingError(503, "ACCOUNT_SETUP_UNAVAILABLE", "Business account provisioning is unavailable.");
        stage = "BUSINESS_PROVISIONING";
        const result = await provision({ requestId: row.id, configuration: row.configuration, configurationHash: row.configuration_hash, approval: claimed.approval! });
        if (!("ownerUid" in result) || result.ownerUid !== account.uid) throw new OnboardingError(502, "ACCOUNT_IDENTITY_CHANGED", "Account creation could not be verified.");
        stage = "FINAL_DRAFT_CHECKPOINT";
        const complete = await change(claimed, operatorId, "business_account_created", { status: "provisioned", provisioning_result: result });
        return accountStatus(complete, true);
      } catch (error) {
        console.error("[onboarding-call] Account creation failed", {
          draftId: row.id,
          product: row.configuration.product,
          stage,
          ...(error instanceof OnboardingError ? { onboardingCode: error.code } : accountSetupFailureDetails(error)),
        });
        await change(claimed, operatorId, "account_creation_failed", { status: "provisioning_failed" });
        if (error instanceof OnboardingError) throw error;
        throw new OnboardingError(502, "ACCOUNT_CREATION_FAILED", "Account creation did not complete. Check its checkpoint before retrying; no setup message was sent.");
      }
    },
    async saveDraft(operatorId: string, raw: SaveOnboardingArguments) {
      const input = saveOnboardingArguments.parse(raw);
      const hash = configurationHash(input.configuration);
      if (input.expectedVersion === 0) {
        const record: OnboardingRecord = {
          id: input.draftId, operator_id: operatorId, version: 1, status: "draft", configuration: input.configuration,
          configuration_hash: hash, binding: null, approval: null, provisioning_result: null,
          updated_at: now(), updated_by: operatorId, last_action: "draft_created",
        };
        const inserted = await deps.repository.insert(record);
        if (inserted) return status(inserted);
        const existing = await getOwned(input.draftId, operatorId);
        if (existing.version === 1 && existing.configuration_hash === hash) return status(existing);
        throw conflict();
      }
      const row = await getOwned(input.draftId, operatorId);
      if (row.version !== input.expectedVersion) throw conflict();
      if (row.status === "provisioning" || row.status === "provisioned") {
        throw new OnboardingError(409, "DRAFT_LOCKED", "Provisioning has started. Use a new reviewed configuration for subsequent changes.");
      }
      return status(await change(row, operatorId, "draft_saved", {
        status: "draft", configuration: input.configuration, configuration_hash: hash, binding: null, approval: null, provisioning_result: null,
      }));
    },
    async getStatus(operatorId: string, draftId: string) { return reviewStatus(await getOwned(draftId, operatorId), false); },
    async sendAccountSetupNotifications(operatorId: string, draftId: string) {
      const row = await getOwned(draftId, operatorId);
      if (row.status !== "provisioned" || row.approval?.method !== "phone_confirmation")
        throw new OnboardingError(409, "ACCOUNT_NOT_PROVISIONED", "Only a completed phone-onboarded business can receive account setup messages.");
      return accountStatus(row, true);
    },
    async submitForReview(operatorId: string, raw: OnboardingVersionArguments) {
      const input = onboardingVersionArguments.parse(raw);
      const row = await getOwned(input.draftId, operatorId);
      if (row.version !== input.expectedVersion) throw conflict();
      if (row.status === "owner_review") return reviewStatus(row, true);
      if (row.status !== "draft") throw new OnboardingError(409, "INVALID_STATE", "Only a draft can be submitted for owner review.");
      const missing = missingOnboardingInformation(row.configuration);
      if (missing.length) throw new OnboardingError(422, "INCOMPLETE_SETUP", `Complete these fields before review: ${missing.join(", ")}.`);
      if (row.configuration.product === "pink")
        throw new OnboardingError(422, "PHONE_CONFIRMATION_REQUIRED", "Use complete_business_onboarding after the caller confirms the Pink signup details and account creation.");
      const binding = await resolveBinding(row.configuration);
      const submitted = await change(row, operatorId, "submitted_for_owner_review", { status: "owner_review", binding, approval: null });
      return reviewStatus(submitted, true);
    },
    async getOwnerReview(owner: string | OwnerIdentity, draftId: string) {
      const identity = typeof owner === "string" ? { uid: owner } : owner;
      const row = await deps.repository.get(draftId);
      if (!row || !ownerMatches(row, identity) || row.status === "draft") {
        throw new OnboardingError(404, "NOT_FOUND", "Owner review not found.");
      }
      await assertBinding(row);
      return status(row);
    },
    async approveAsOwner(owner: string | OwnerIdentity, raw: OwnerApprovalArguments) {
      const identity = typeof owner === "string" ? { uid: owner } : owner;
      const ownerUid = identity.uid;
      const input = ownerApprovalArguments.parse(raw);
      const row = await deps.repository.get(input.draftId);
      if (!row || !ownerMatches(row, identity)) throw new OnboardingError(404, "NOT_FOUND", "Owner review not found.");
      if (row.version !== input.expectedVersion) throw conflict();
      if (row.status !== "owner_review") throw new OnboardingError(409, "INVALID_STATE", "This setup is not awaiting owner approval.");
      await assertBinding(row);
      const termsVersion = row.configuration.terms?.version;
      if (!termsVersion || missingOnboardingInformation(row.configuration).length) throw new OnboardingError(422, "INCOMPLETE_SETUP", "The setup must be completed and reviewed again.");
      return status(await change(row, `black-owner:${ownerUid}`, "owner_approved", {
        status: "approved", approval: { ownerUid, reviewedVersion: row.version, termsVersion, approvedAt: now(), configurationHash: row.configuration_hash },
      }));
    },
    async provisionApprovedBusiness(operatorId: string, raw: OnboardingVersionArguments) {
      const input = onboardingVersionArguments.parse(raw);
      const row = await getOwned(input.draftId, operatorId);
      if (row.version !== input.expectedVersion) throw conflict();
      await assertBinding(row);
      if (row.status === "provisioned") return status(row);
      const stale = row.status === "provisioning" && Date.parse(now()) - Date.parse(row.updated_at) > 5 * 60 * 1000;
      if (!["approved", "provisioning_failed"].includes(row.status) && !stale) {
        throw new OnboardingError(409, "APPROVAL_REQUIRED", "Owner approval is required, or provisioning is already in progress.");
      }
      if (!row.approval || (!row.binding || (!("kind" in row.binding) && row.approval.ownerUid !== row.binding.ownerUid)) ||
          row.approval.termsVersion !== row.configuration.terms?.version || (row.approval.configurationHash && row.approval.configurationHash !== row.configuration_hash)) {
        throw new OnboardingError(409, "APPROVAL_REQUIRED", "Obtain owner approval for this configuration before provisioning.");
      }
      const claimed = await change(row, operatorId, "provisioning_started", { status: "provisioning" });
      let result: OnboardingProvisioningResult;
      try {
        if (claimed.binding && "kind" in claimed.binding) {
          if (claimed.configuration.product === "pink") {
            throw new OnboardingError(422, "PHONE_CONFIRMATION_REQUIRED", "Complete Pink signup through the confirmed account-creation flow.");
          } else if (claimed.configuration.product === "trade") {
            if (!deps.provisionTradeBusiness) throw new OnboardingError(503, "TRADE_SETUP_UNAVAILABLE", "Trade business provisioning is not configured.");
            result = await deps.provisionTradeBusiness({ requestId: claimed.id, configuration: claimed.configuration, configurationHash: claimed.configuration_hash, approval: claimed.approval! });
          } else {
            if (!deps.provisionBlackBusiness) throw new OnboardingError(503, "BLACK_SETUP_UNAVAILABLE", "Black business provisioning is not configured.");
            result = await deps.provisionBlackBusiness({ requestId: claimed.id, configuration: claimed.configuration, configurationHash: claimed.configuration_hash, approval: claimed.approval! });
          }
        } else {
          const binding = claimed.binding as ExistingOnboardingBinding;
          result = await deps.provision({ did: binding.did, name: claimed.configuration.receptionistName!, createdBy: operatorId, expectedAssignment: binding });
        }
      } catch {
        await change(claimed, operatorId, "provisioning_failed", { status: "provisioning_failed" });
        throw new OnboardingError(502, "PROVISIONING_FAILED", "Black setup did not complete. Check status and reconcile its provisioning checkpoint before retrying.");
      }
      return status(await change(claimed, operatorId, "identity_provisioned", { status: "provisioned", provisioning_result: result }));
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
