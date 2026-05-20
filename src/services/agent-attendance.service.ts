import type {
  AgentAttendanceEventCreateInput,
  AgentAttendanceEventRow,
  AgentAttendanceEventType,
  AgentAttendanceListFilters,
  AgentAttendanceListResult,
  AgentAttendanceReportFilters,
  AgentAttendanceReportResult,
  AgentAttendanceShiftState,
  AgentAttendanceStatus,
} from "../types/agent-attendance.types.js";
import {
  createAgentAttendanceEventViaSupabase,
  getAgentAttendanceEventByIdViaSupabase,
  getAgentAttendanceReportViaSupabase,
  getLatestAgentAttendanceEventForUserViaSupabase,
  listAgentAttendanceEventsViaSupabase,
} from "./shared/agent-attendance.pipeline.js";

const ALLOWED_NEXT: Record<
  AgentAttendanceEventType | "none",
  AgentAttendanceEventType[]
> = {
  none: ["clock_in"],
  clock_out: ["clock_in"],
  clock_in: ["break_start", "clock_out"],
  break_start: ["break_end"],
  break_end: ["break_start", "clock_out"],
};

function transitionKey(
  latest: AgentAttendanceEventRow | null
): AgentAttendanceEventType | "none" {
  if (!latest) return "none";
  if (latest.event_type === "clock_out") return "clock_out";
  return latest.event_type;
}

export function deriveShiftState(
  latest: AgentAttendanceEventRow | null
): AgentAttendanceShiftState {
  if (!latest || latest.event_type === "clock_out") return "off_shift";
  if (latest.event_type === "break_start") return "on_break";
  return "on_shift";
}

export function buildAttendanceStatus(
  userId: string,
  latest: AgentAttendanceEventRow | null,
  agentId?: string | null
): AgentAttendanceStatus {
  return {
    user_id: userId,
    agent_id: agentId ?? null,
    state: deriveShiftState(latest),
    last_event: latest,
  };
}

export function validateAttendanceTransition(
  latest: AgentAttendanceEventRow | null,
  nextType: AgentAttendanceEventType
): string | null {
  const key = transitionKey(latest);
  const allowed = ALLOWED_NEXT[key];
  if (!allowed.includes(nextType)) {
    const current =
      key === "none"
        ? "off shift"
        : key === "break_start"
          ? "on break"
          : key === "clock_in" || key === "break_end"
            ? "on shift"
            : "off shift";
    return `Cannot record "${nextType}" while ${current}. Allowed next: ${allowed.join(", ") || "none"}.`;
  }
  return null;
}

export async function listAgentAttendanceEvents(
  filters: AgentAttendanceListFilters
): Promise<AgentAttendanceListResult> {
  return listAgentAttendanceEventsViaSupabase({ filters });
}

export async function getAgentAttendanceReport(
  filters: AgentAttendanceReportFilters
): Promise<AgentAttendanceReportResult> {
  return getAgentAttendanceReportViaSupabase({ filters });
}

export async function getAgentAttendanceEventById(
  id: string
): Promise<AgentAttendanceEventRow | null> {
  return getAgentAttendanceEventByIdViaSupabase({ id });
}

export async function getAgentAttendanceStatusForUser(
  userId: string,
  agentId?: string | null
): Promise<AgentAttendanceStatus> {
  const latest = await getLatestAgentAttendanceEventForUserViaSupabase({
    userId,
  });
  return buildAttendanceStatus(userId, latest, agentId);
}

export async function recordAgentAttendanceEvent(
  input: AgentAttendanceEventCreateInput
): Promise<AgentAttendanceEventRow> {
  const latest = await getLatestAgentAttendanceEventForUserViaSupabase({
    userId: input.userId,
  });
  const transitionError = validateAttendanceTransition(latest, input.eventType);
  if (transitionError) {
    throw new Error(transitionError);
  }

  return createAgentAttendanceEventViaSupabase({ row: input });
}

/** Whether a user may read this attendance event row. */
export function userMayViewAttendanceEvent(
  row: AgentAttendanceEventRow,
  userId: string
): boolean {
  return row.user_id === userId;
}
