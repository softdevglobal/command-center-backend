import type {
  CallListFilters,
  CallListResult,
  CallPublicRow,
  CallRow,
} from "../types/call.types.js";
import {
  getCallByIdViaSupabase,
  listCallsViaSupabase,
} from "./shared/calls.pipeline.js";

export function toPublicCall(
  row: CallRow,
  includeRecording: boolean
): CallPublicRow {
  if (includeRecording) return row;
  const { recording_url: _recordingUrl, ...rest } = row;
  return rest;
}

export function toPublicCalls(
  rows: CallRow[],
  includeRecording: boolean
): CallPublicRow[] {
  return rows.map((row) => toPublicCall(row, includeRecording));
}

export async function listCalls(
  filters: CallListFilters
): Promise<CallListResult> {
  return listCallsViaSupabase({ filters });
}

export async function getCallById(id: string): Promise<CallRow | null> {
  return getCallByIdViaSupabase({ id });
}

/** Whether an agent may read this call (answered by them). */
export function agentMayViewCall(
  row: CallRow,
  agentId: string
): boolean {
  return row.agent_id === agentId && row.answer_time != null;
}
