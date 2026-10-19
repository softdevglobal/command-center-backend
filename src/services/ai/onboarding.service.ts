import { createHash } from "node:crypto";
import type { DidMappingRow } from "../../types/did-mapping.types.js";
import type { BlackAiAgentProvisioningInput } from "./black-ai-agent-provisioning.service.js";
import { blackEndpoint } from "../../config/black-api.js";
import {
  missingOnboardingInformation, saveOnboardingArguments, onboardingVersionArguments, ownerApprovalArguments,
  type OnboardingConfiguration, type SaveOnboardingArguments, type OnboardingVersionArguments, type OwnerApprovalArguments,
} from "./onboarding.schemas.js";

export class OnboardingError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export type ExistingOnboardingBinding = { did: string; tenantId: string; ownerUid: string; branchId: string; queueId: string };
export type OnboardingBinding = ExistingOnboardingBinding | { kind: "new_business"; ownerEmail: string };
export type OnboardingApproval = { ownerUid: string; reviewedVersion: number; termsVersion: string; approvedAt: string; configurationHash?: string };
export type BlackBusinessResult = { status: "TEST_MODE"; ownerUid: string; branchId: string; serviceIds: string[]; staffIds: string[]; created: boolean };
export type OnboardingProvisioningResult = { firebaseBlackUid: string; did: string; name: string; created: boolean } | BlackBusinessResult;
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
      ownerReviewUrl: row.status !== "draft" ? blackEndpoint(`/onboarding/${row.id}`) : null,
      nextAction: row.status === "provisioned" ? "Complete billing authorization, staff invitations, approved runtime settings and phone routing; run pilot checks and obtain launch approval."
        : row.status === "owner_review" ? "The business owner must sign in, verify their email and approve this exact setup in Black."
        : row.status === "approved" || row.status === "provisioning_failed" ? "Provision the approved Black business setup."
        : row.status === "provisioning" ? "Provisioning is in progress; check status before retrying."
        : "Complete the missing information and submit for owner review.",
    };
  }
  return {
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
    async getStatus(operatorId: string, draftId: string) { return status(await getOwned(draftId, operatorId)); },
    async submitForReview(operatorId: string, raw: OnboardingVersionArguments) {
      const input = onboardingVersionArguments.parse(raw);
      const row = await getOwned(input.draftId, operatorId);
      if (row.version !== input.expectedVersion) throw conflict();
      if (row.status === "owner_review") return status(row);
      if (row.status !== "draft") throw new OnboardingError(409, "INVALID_STATE", "Only a draft can be submitted for owner review.");
      const missing = missingOnboardingInformation(row.configuration);
      if (missing.length) throw new OnboardingError(422, "INCOMPLETE_SETUP", `Complete these fields before review: ${missing.join(", ")}.`);
      const binding = await resolveBinding(row.configuration);
      return status(await change(row, operatorId, "submitted_for_owner_review", { status: "owner_review", binding, approval: null }));
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
          if (!deps.provisionBlackBusiness) throw new OnboardingError(503, "BLACK_SETUP_UNAVAILABLE", "Black business provisioning is not configured.");
          result = await deps.provisionBlackBusiness({ requestId: claimed.id, configuration: claimed.configuration, configurationHash: claimed.configuration_hash, approval: claimed.approval! });
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
