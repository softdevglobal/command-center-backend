export type AgentLeaveDurationType = "full_day" | "half_day";

export type AgentLeaveHalfDayPart = "am" | "pm";

export type AgentLeaveRequestStatus = "pending" | "approved" | "rejected";

export type AgentLeaveReviewStatus = Exclude<AgentLeaveRequestStatus, "pending">;

/** Row shape for `public.agent_leave_requests`. */
export type AgentLeaveRequestRow = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  agent_display_name: string | null;
  start_date: string;
  end_date: string;
  duration_type: AgentLeaveDurationType;
  half_day_part: AgentLeaveHalfDayPart | null;
  reason: string | null;
  status: AgentLeaveRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  created_at: string;
  attachment_storage_path: string | null;
};

export type AgentLeaveRequestCreateInput = {
  userId: string;
  startDate: string;
  endDate: string;
  durationType: AgentLeaveDurationType;
  halfDayPart?: AgentLeaveHalfDayPart | null;
  reason?: string | null;
  tenantId?: string | null;
  agentDisplayName?: string | null;
  attachmentStoragePath?: string | null;
};

export type AgentLeaveRequestListFilters = {
  userId?: string;
  tenantId?: string;
  status?: AgentLeaveRequestStatus;
  /** Include requests whose date range overlaps this date or later. */
  from?: string;
  /** Include requests whose date range overlaps this date or earlier. */
  to?: string;
  limit?: number;
  offset?: number;
  /** Agents: restricted to this Supabase Auth user id. */
  scopeUserId?: string;
};

export type AgentLeaveRequestListResult = {
  data: AgentLeaveRequestRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AgentLeaveRequestReviewInput = {
  status: AgentLeaveReviewStatus;
  reviewedBy: string;
  reviewComment?: string | null;
};
