/** Row shape for `public.calls`. */
export type CallRow = {
  id: string;
  tenant_id: string;
  queue_id: string;
  agent_id: string | null;
  caller_number: string;
  caller_name: string | null;
  start_time: string;
  answer_time: string | null;
  end_time: string | null;
  duration_seconds: number;
  result: string;
  recording_url: string | null;
  transcript_status: string;
  summary_status: string;
  created_at: string;
  direction: string;
  dialed_number: string | null;
};

/** Call payload returned to clients (`recording_url` only for super admins). */
export type CallPublicRow = Omit<CallRow, "recording_url"> & {
  recording_url?: string | null;
};

export type CallDirection = "inbound" | "outbound";

export type CallListFilters = {
  tenantId?: string;
  queueId?: string;
  agentId?: string;
  /** Partial match on `caller_name` (case-insensitive). */
  callerName?: string;
  direction?: CallDirection;
  result?: string;
  /** Inclusive start of `start_time` range (ISO 8601). */
  from?: string;
  /** Inclusive end of `start_time` range (ISO 8601). */
  to?: string;
  limit?: number;
  offset?: number;
  /** When set, restrict to this agent and answered calls only. */
  scopeAgentId?: string;
};

export type CallListResult = {
  data: CallRow[];
  total: number;
  limit: number;
  offset: number;
};

export type CallListPublicResult = {
  data: CallPublicRow[];
  total: number;
  limit: number;
  offset: number;
};

export type CallMetricsFilters = {
  tenantId?: string;
  queueId?: string;
  agentId?: string;
  direction?: CallDirection;
  /** Inclusive start of `calls.start_time` range (ISO 8601). */
  from: string;
  /** Inclusive end of `calls.start_time` range (ISO 8601). */
  to: string;
  /** SLA target in seconds from call start to answer. */
  slaSeconds: number;
};

export type OnlineAgentsCountFilters = {
  tenantId?: string;
  queueId?: string;
  ownerUid?: string;
  branchId?: string;
  role?: string;
  agentType?: "all" | "command-centre" | "workshop";
  onlineStatuses: string[];
};

export type DashboardMetricsFilters = CallMetricsFilters &
  OnlineAgentsCountFilters;

export type DashboardCallMetrics = {
  today_calls_count: number;
  answered_calls_count: number;
  abandoned_calls_count: number;
  answer_rate_percent: number;
  abandon_rate_percent: number;
  average_handle_seconds: number;
  sla_percent: number;
  sla_answered_within_threshold_count: number;
  sla_threshold_seconds: number;
};

export type DashboardMetricsResult = DashboardCallMetrics & {
  online_agents_count: number;
  from: string;
  to: string;
  online_statuses: string[];
};
