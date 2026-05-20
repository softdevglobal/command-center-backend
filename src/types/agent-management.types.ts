import type {
  AgentType,
  WorkshopUserRole,
} from "./agent-registration.types.js";

export type AgentRow = {
  id: string;
  tenant_id: string | null;
  queue_ids: string[];
  name: string;
  extension: string;
  role: string;
  status: string;
  current_caller: string | null;
  call_start_time: number | null;
  created_at: string;
  updated_at: string;
  email: string;
  notes: string;
  phone_number: string;
  group_ids: string | null;
  user_id: string | null;
  bms_owner_uid: string | null;
  bms_branch_id: string | null;
  workshop_user_role: WorkshopUserRole | null;
  allowed_queue_ids: string[];
};

export type AgentListFilters = {
  agentType?: AgentType | "all";
  tenantId?: string;
  ownerUid?: string;
  branchId?: string;
  role?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type AgentListResult = {
  data: AgentRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AgentPerformanceFilters = AgentListFilters & {
  agentId?: string;
  queueId?: string;
  direction?: "inbound" | "outbound";
  from?: string;
  to?: string;
};

export type AgentPerformanceRow = {
  agent: AgentRow;
  metrics: {
    total_calls: number;
    answered_calls: number;
    missed_calls: number;
    inbound_calls: number;
    outbound_calls: number;
    total_duration_seconds: number;
    average_duration_seconds: number;
    answer_rate_percent: number;
    first_call_start_time: string | null;
    last_call_start_time: string | null;
  };
};

export type AgentPerformanceResult = {
  data: AgentPerformanceRow[];
  totals: AgentPerformanceRow["metrics"];
  total: number;
  limit: number;
  offset: number;
};

export type AgentUpdateInput = {
  agentType?: AgentType;
  tenantId?: string | null;
  queueIds?: string[];
  allowedQueueIds?: string[];
  name?: string;
  extension?: string;
  role?: string;
  status?: string;
  currentCaller?: string | null;
  callStartTime?: number | null;
  email?: string;
  notes?: string;
  phone?: string;
  phoneNumber?: string;
  groupIds?: string | null;
  workshopOwnerUid?: string | null;
  bmsOwnerUid?: string | null;
  workshopBranchId?: string | null;
  bmsBranchId?: string | null;
  workshopUserRole?: WorkshopUserRole | "" | null;
};

export type AgentDeleteResult = {
  agent: AgentRow;
  userId: string | null;
  authUserDeleted: boolean;
  warnings: string[];
};
