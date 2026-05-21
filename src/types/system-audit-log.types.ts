/** Row shape for `public.system_audit_logs`. */
export type SystemAuditLogRow = {
  id: string;
  created_at: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
};

export type SystemAuditLogListFilters = {
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type SystemAuditLogListResult = {
  data: SystemAuditLogRow[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateSystemAuditLogInput = {
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
};

export type CreateSystemAuditLogRequestBody = {
  action?: string;
  resourceType?: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
};
