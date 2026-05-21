import type {
  CreateSystemAuditLogInput,
  SystemAuditLogListFilters,
  SystemAuditLogListResult,
  SystemAuditLogRow,
} from "../types/system-audit-log.types.js";
import {
  createSystemAuditLogViaSupabase,
  getSystemAuditLogByIdViaSupabase,
  listSystemAuditLogsViaSupabase,
} from "./shared/system-audit-logs.pipeline.js";

export async function createSystemAuditLog(
  body: CreateSystemAuditLogInput
): Promise<SystemAuditLogRow> {
  return createSystemAuditLogViaSupabase({ body });
}

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
