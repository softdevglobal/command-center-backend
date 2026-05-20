import {
  AGENT_SHIFT_SCHEDULE_WEEKDAYS,
  type AgentShiftScheduleListFilters,
  type AgentShiftScheduleListResult,
  type AgentShiftScheduleRow,
  type AgentShiftScheduleUpsertInput,
  type AgentShiftScheduleUpsertResult,
} from "../types/agent-shift-schedule.types.js";
import {
  getAgentShiftScheduleByAgentIdViaSupabase,
  listAgentShiftSchedulesViaSupabase,
  upsertAgentShiftScheduleViaSupabase,
} from "./shared/agent-shift-schedules.pipeline.js";

export function validateAgentShiftScheduleUpsertInput(
  input: AgentShiftScheduleUpsertInput
): string | null {
  if (!input.agentId.trim()) return "agentId is required.";

  const hasAnyDay = AGENT_SHIFT_SCHEDULE_WEEKDAYS.some((day) =>
    Object.prototype.hasOwnProperty.call(input.days, day)
  );
  if (!hasAnyDay) {
    return "At least one weekday shift value is required.";
  }

  return null;
}

export async function listAgentShiftSchedules(
  filters: AgentShiftScheduleListFilters
): Promise<AgentShiftScheduleListResult> {
  return listAgentShiftSchedulesViaSupabase({ filters });
}

export async function getAgentShiftScheduleByAgentId(
  agentId: string
): Promise<AgentShiftScheduleRow | null> {
  return getAgentShiftScheduleByAgentIdViaSupabase({ agentId });
}

export async function upsertAgentShiftSchedule(
  input: AgentShiftScheduleUpsertInput
): Promise<AgentShiftScheduleUpsertResult> {
  const validationError = validateAgentShiftScheduleUpsertInput(input);
  if (validationError) throw new Error(validationError);
  return upsertAgentShiftScheduleViaSupabase({ row: input });
}

/** Whether an agent may read this schedule row. */
export function agentMayViewShiftSchedule(
  row: AgentShiftScheduleRow,
  agentId: string
): boolean {
  return row.agent_id === agentId;
}
