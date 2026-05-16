import type {
  SystemAuditLogListFilters,
  SystemAuditLogListResult,
  SystemAuditLogRow,
} from "../types/system-audit-log.types.js";
import {
  getSystemAuditLogByIdViaSupabase,
  listSystemAuditLogsViaSupabase,
} from "./shared/system-audit-logs.pipeline.js";

export async function listSystemAuditLogs(
  filters: SystemAuditLogListFilters
): Promise<SystemAuditLogListResult> {
  return listSystemAuditLogsViaSupabase({ filters });
}

export async function getSystemAuditLogById(
  id: string
): Promise<SystemAuditLogRow | null> {
  return getSystemAuditLogByIdViaSupabase({ id });
}
