import type {
  AgentLeaveRequestCreateInput,
  AgentLeaveRequestListFilters,
  AgentLeaveRequestListResult,
  AgentLeaveRequestReviewInput,
  AgentLeaveRequestRow,
} from "../types/agent-leave-request.types.js";
import {
  createAgentLeaveRequestViaSupabase,
  getAgentLeaveRequestByIdViaSupabase,
  listAgentLeaveRequestsViaSupabase,
  reviewAgentLeaveRequestViaSupabase,
} from "./shared/agent-leave-requests.pipeline.js";

function isValidDateOnly(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function validateAgentLeaveRequestCreateInput(
  input: AgentLeaveRequestCreateInput
): string | null {
  if (!input.userId.trim()) return "userId is required.";
  if (!isValidDateOnly(input.startDate)) {
    return "startDate must be a valid date in YYYY-MM-DD format.";
  }
  if (!isValidDateOnly(input.endDate)) {
    return "endDate must be a valid date in YYYY-MM-DD format.";
  }
  if (input.endDate < input.startDate) {
    return "endDate must be the same as or after startDate.";
  }
  if (input.durationType === "full_day" && input.halfDayPart != null) {
    return "halfDayPart must be omitted for full_day leave requests.";
  }
  if (input.durationType === "half_day" && input.halfDayPart == null) {
    return 'halfDayPart is required for half_day leave requests: "am" or "pm".';
  }
  return null;
}

export async function listAgentLeaveRequests(
  filters: AgentLeaveRequestListFilters
): Promise<AgentLeaveRequestListResult> {
  return listAgentLeaveRequestsViaSupabase({ filters });
}

export async function getAgentLeaveRequestById(
  id: string
): Promise<AgentLeaveRequestRow | null> {
  return getAgentLeaveRequestByIdViaSupabase({ id });
}

export async function createAgentLeaveRequest(
  input: AgentLeaveRequestCreateInput
): Promise<AgentLeaveRequestRow> {
  const validationError = validateAgentLeaveRequestCreateInput(input);
  if (validationError) throw new Error(validationError);
  return createAgentLeaveRequestViaSupabase({ row: input });
}

export async function reviewAgentLeaveRequest(
  id: string,
  input: AgentLeaveRequestReviewInput
): Promise<AgentLeaveRequestRow | null> {
  return reviewAgentLeaveRequestViaSupabase({ id, review: input });
}

/** Whether a user may read this leave request row. */
export function userMayViewLeaveRequest(
  row: AgentLeaveRequestRow,
  userId: string
): boolean {
  return row.user_id === userId;
}

export function isDateOnly(value: string): boolean {
  return isValidDateOnly(value);
}
