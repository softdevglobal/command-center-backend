/** Mirrors the `create-agent` Edge Function body + agents table fields. */

export type WorkshopUserRole = "owner" | "branch_admin" | "staff";

export type AgentType = "workshop" | "command-centre";

export type CreateAgentRequestBody = {
  name: string;
  email: string;
  phone: string;
  password: string;
  extension: string;
  notes?: string;
  agentType?: AgentType;
  tenantId?: string | null;
  workshopOwnerUid?: string;
  workshopName?: string;
  workshopBranchId?: string;
  workshopBranchName?: string;
  workshopUserRole?: WorkshopUserRole | "";
};

/** Supabase `agents` row + auth user. */
export type RegisterAgentResult = {
  agentId: string;
  userId: string;
};
