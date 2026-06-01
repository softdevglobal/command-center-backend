export type SmsQueueRow = {
  id: string;
  queue_name: string;
  sort_order: number | null;
  created_at: string;
};

export type SmsThreadStatus = "QUEUED" | "ACTIVE" | "RESOLVED";

export type SmsThreadRow = {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  current_queue_id: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  status: SmsThreadStatus;
  unread_for_agent: number;
  last_message_body: string | null;
  last_message_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SmsMessageDirection = "INBOUND" | "OUTBOUND";

export type SmsMessageRow = {
  id: string;
  thread_id: string;
  direction: SmsMessageDirection;
  message_body: string;
  sender_agent_id: string | null;
  sender_agent_name: string | null;
  textbee_message_id: string | null;
  textbee_status: string | null;
  created_at: string;
};

export type SmsThreadWithQueue = SmsThreadRow & {
  queue_name: string | null;
};

export type SmsInboxResult = {
  queues: SmsQueueRow[];
  threads: SmsThreadWithQueue[];
  unreadCount: number;
};

export type SmsActor = {
  agentId: string;
  agentName: string;
  isSuperAdmin: boolean;
};

export type NormalizedTextBeeInbound = {
  phone: string;
  message: string;
  smsId: string | null;
  receivedAt: string;
};
