/** Allowed values for `agent_attendance_events.event_type`. */
export type AgentAttendanceEventType =
  | "clock_in"
  | "break_start"
  | "break_end"
  | "clock_out";

/** Row shape for `public.agent_attendance_events`. */
export type AgentAttendanceEventRow = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  agent_display_name: string | null;
  event_type: AgentAttendanceEventType;
  occurred_at: string;
  created_at: string;
};

export type AgentAttendanceListFilters = {
  userId?: string;
  tenantId?: string;
  eventType?: AgentAttendanceEventType;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  /** Agents: restricted to this Supabase Auth user id. */
  scopeUserId?: string;
};

export type AgentAttendanceListResult = {
  data: AgentAttendanceEventRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AgentAttendanceEventCreateInput = {
  userId: string;
  eventType: AgentAttendanceEventType;
  tenantId?: string | null;
  agentDisplayName?: string | null;
  occurredAt?: string;
};

/** Derived shift state from the latest attendance event. */
export type AgentAttendanceShiftState = "off_shift" | "on_shift" | "on_break";

export type AgentAttendanceStatus = {
  user_id: string;
  /** `agents.id` when known (from agentId query or linked profile). */
  agent_id: string | null;
  state: AgentAttendanceShiftState;
  last_event: AgentAttendanceEventRow | null;
};

export type AgentAttendanceReportGroupBy = "day" | "week" | "month";

export type AgentAttendanceReportFilters = {
  groupBy: AgentAttendanceReportGroupBy;
  from: string;
  to: string;
  userId?: string;
  tenantId?: string;
};

export type AgentAttendanceAgentMetrics = {
  user_id: string;
  agent_id: string | null;
  agent_display_name: string | null;
  total_days: number;
  total_working_hours: number;
  avg_hours_per_day: number;
};

export type AgentAttendanceReportSummary = {
  total_days: number;
  total_working_hours: number;
  avg_hours_per_day: number;
  agent_count?: number;
};

export type AgentAttendancePeriodMetrics = {
  period_key: string;
  period_start: string;
  period_end: string;
  total_days: number;
  total_working_hours: number;
  avg_hours_per_day: number;
  agents: AgentAttendanceAgentMetrics[];
};

export type AgentAttendanceReportResult = {
  group_by: AgentAttendanceReportGroupBy;
  from: string;
  to: string;
  summary: AgentAttendanceReportSummary;
  periods: AgentAttendancePeriodMetrics[];
  /** Present when the report is scoped to a single agent. */
  agent?: AgentAttendanceAgentMetrics;
};
