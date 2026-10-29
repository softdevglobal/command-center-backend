import type { DidMappingRow } from "../../types/did-mapping.types.js";

export class AiAgentSetupError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export type ProvisioningIdentity = { uid: string; disabled: boolean };
export type ProvisioningDependencies = {
  getMapping: (did: string) => Promise<DidMappingRow | null>;
  getAgent: (uid: string) => Promise<Record<string, unknown> | undefined>;
  getUser: (uid: string) => Promise<ProvisioningIdentity>;
  createUser: (input: { uid: string; displayName: string }) => Promise<ProvisioningIdentity>;
  markUser: (uid: string) => Promise<void>;
  createAgent: (uid: string, data: Record<string, unknown>) => Promise<void>;
  deleteUser: (uid: string) => Promise<void>;
};
