export const AGENT_SHIFT_SCHEDULE_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type AgentShiftScheduleWeekday =
  (typeof AGENT_SHIFT_SCHEDULE_WEEKDAYS)[number];

export type AgentShiftScheduleDayValues = Partial<
  Record<AgentShiftScheduleWeekday, string | null>
>;

export type AgentShiftScheduleFullDayValues = Record<
  AgentShiftScheduleWeekday,
  string | null
>;

/** Row shape for `public.agent_shift_schedules`. */
export type AgentShiftScheduleRow = AgentShiftScheduleFullDayValues & {
  id: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
};

export type AgentShiftScheduleListFilters = {
  agentId?: string;
  limit?: number;
  offset?: number;
  /** Agents: restricted to their linked `agents.id`. */
  scopeAgentId?: string;
};

export type AgentShiftScheduleListResult = {
  data: AgentShiftScheduleRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AgentShiftScheduleUpsertInput = {
  agentId: string;
  days: AgentShiftScheduleDayValues;
};

export type AgentShiftScheduleUpsertResult = {
  row: AgentShiftScheduleRow;
  created: boolean;
};
