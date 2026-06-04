import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { roleMayRegisterAgents } from "../config/supabase-app-role.js";
import {
  getMissingTextBeeOutboundEnv,
  getTextBeeConfig,
} from "../config/textbee.js";
import {
  createSupabaseClient,
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";
import type {
  SmsActor,
  SmsInboxResult,
  SmsMessageRow,
  SmsQueueRow,
  SmsThreadRow,
  SmsThreadStatus,
  SmsThreadWithQueue,
} from "../types/sms.types.js";
import { getAgentProfileByUserIdInSupabase } from "./shared/supabase-agents.service.js";

const SMS_QUEUE_SEEDS = [
  { queue_name: "Sales", sort_order: 1 },
  { queue_name: "Support", sort_order: 2 },
  { queue_name: "Billing", sort_order: 3 },
  { queue_name: "VIP", sort_order: 4 },
] as const;

const DEFAULT_QUEUE_NAME = "Sales";

export class SmsServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function assertSupabaseForSms(): {
  supabaseUrl: string;
  serviceRoleKey: string;
} {
  const supabaseUrl = getSupabaseProjectUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new SmsServiceError(
      500,
      missing.length > 0
        ? `Missing or unset Supabase env: ${missing.join(", ")}. Ensure project-root .env exists and restart the server.`
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for SMS APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

function adminClient(): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSms();
  return createSupabaseClient(supabaseUrl, serviceRoleKey);
}

function withSmsSchemaHint(message: string): string {
  return `${message}. If SMS tables are not installed yet, run scripts/create-sms-tables.sql in the Supabase SQL Editor.`;
}

function throwSupabaseError(error: { message: string }): never {
  throw new SmsServiceError(500, withSmsSchemaHint(error.message));
}

function cleanRequired(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SmsServiceError(400, `${label} is required.`);
  }
  return trimmed;
}

function displayNameFromUser(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  for (const key of ["display_name", "full_name", "name"]) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return user.email ?? user.id;
}

function isDuplicateKeyMessage(message: string): boolean {
  return /duplicate key|23505/i.test(message);
}

function normalizeTextBeeResponseId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["smsId", "messageId", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

async function findQueueById(
  supabase: SupabaseClient,
  queueId: string
): Promise<SmsQueueRow | null> {
  const { data, error } = await supabase
    .from("sms_queues")
    .select("*")
    .eq("id", queueId)
    .maybeSingle();

  if (error) throwSupabaseError(error);
  return (data as SmsQueueRow | null) ?? null;
}

async function findQueueByName(
  supabase: SupabaseClient,
  queueName: string
): Promise<SmsQueueRow | null> {
  const { data, error } = await supabase
    .from("sms_queues")
    .select("*")
    .eq("queue_name", queueName)
    .maybeSingle();

  if (error) throwSupabaseError(error);
  return (data as SmsQueueRow | null) ?? null;
}

async function requireQueue(
  supabase: SupabaseClient,
  queueId: string | null
): Promise<SmsQueueRow> {
  if (queueId) {
    const queue = await findQueueById(supabase, queueId);
    if (!queue) throw new SmsServiceError(404, "SMS queue not found.");
    return queue;
  }

  const queue = await findQueueByName(supabase, DEFAULT_QUEUE_NAME);
  if (!queue) {
    throw new SmsServiceError(
      500,
      `Default SMS queue "${DEFAULT_QUEUE_NAME}" is missing.`
    );
  }
  return queue;
}

async function findThreadByPhone(
  supabase: SupabaseClient,
  customerPhone: string
): Promise<SmsThreadRow | null> {
  const { data, error } = await supabase
    .from("sms_threads")
    .select("*")
    .eq("customer_phone", customerPhone)
    .maybeSingle();

  if (error) throwSupabaseError(error);
  return (data as SmsThreadRow | null) ?? null;
}

async function createThread(
  supabase: SupabaseClient,
  input: {
    customerPhone: string;
    queueId: string;
    status: SmsThreadStatus;
    actor?: SmsActor;
  }
): Promise<SmsThreadRow> {
  const payload: Record<string, unknown> = {
    id: randomUUID(),
    customer_phone: input.customerPhone,
    current_queue_id: input.queueId,
    status: input.status,
    unread_for_agent: 0,
  };
  if (input.actor) {
    payload.assigned_agent_id = input.actor.agentId;
    payload.assigned_agent_name = input.actor.agentName;
  }

  const { data, error } = await supabase
    .from("sms_threads")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isDuplicateKeyMessage(error.message)) {
      const existing = await findThreadByPhone(supabase, input.customerPhone);
      if (existing) return existing;
    }
    throwSupabaseError(error);
  }

  return data as SmsThreadRow;
}

async function getOrCreateThreadForPhone(
  supabase: SupabaseClient,
  input: {
    customerPhone: string;
    queueId: string;
    status: SmsThreadStatus;
    actor?: SmsActor;
  }
): Promise<{ thread: SmsThreadRow; created: boolean }> {
  const existing = await findThreadByPhone(supabase, input.customerPhone);
  if (existing) return { thread: existing, created: false };

  const thread = await createThread(supabase, input);
  return { thread, created: true };
}

async function getThreadById(
  supabase: SupabaseClient,
  threadId: string
): Promise<SmsThreadRow | null> {
  const { data, error } = await supabase
    .from("sms_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();

  if (error) throwSupabaseError(error);
  return (data as SmsThreadRow | null) ?? null;
}

async function insertSmsMessage(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    direction: "INBOUND" | "OUTBOUND";
    messageBody: string;
    createdAt?: string;
    senderAgentId?: string | null;
    senderAgentName?: string | null;
    textbeeMessageId?: string | null;
    textbeeStatus?: string | null;
  }
): Promise<SmsMessageRow> {
  const payload: Record<string, unknown> = {
    id: randomUUID(),
    thread_id: input.threadId,
    direction: input.direction,
    message_body: input.messageBody,
  };
  if (input.createdAt) payload.created_at = input.createdAt;
  if (input.senderAgentId) payload.sender_agent_id = input.senderAgentId;
  if (input.senderAgentName) payload.sender_agent_name = input.senderAgentName;
  if (input.textbeeMessageId) payload.textbee_message_id = input.textbeeMessageId;
  if (input.textbeeStatus) payload.textbee_status = input.textbeeStatus;

  const { data, error } = await supabase
    .from("sms_messages")
    .insert(payload)
    .select("*")
    .single();

  if (error) throwSupabaseError(error);
  return data as SmsMessageRow;
}

async function updateThread(
  supabase: SupabaseClient,
  threadId: string,
  patch: Record<string, unknown>
): Promise<SmsThreadRow> {
  const { data, error } = await supabase
    .from("sms_threads")
    .update(patch)
    .eq("id", threadId)
    .select("*")
    .single();

  if (error) throwSupabaseError(error);
  return data as SmsThreadRow;
}

async function updateMessageTextBeeStatus(
  supabase: SupabaseClient,
  messageId: string,
  input: { textbeeMessageId?: string | null; textbeeStatus: string }
): Promise<SmsMessageRow> {
  const patch: Record<string, unknown> = {
    textbee_status: input.textbeeStatus,
  };
  if (input.textbeeMessageId) {
    patch.textbee_message_id = input.textbeeMessageId;
  }

  const { data, error } = await supabase
    .from("sms_messages")
    .update(patch)
    .eq("id", messageId)
    .select("*")
    .single();

  if (error) throwSupabaseError(error);
  return data as SmsMessageRow;
}

export async function ensureSmsQueues(): Promise<SmsQueueRow[]> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("sms_queues")
    .upsert([...SMS_QUEUE_SEEDS], { onConflict: "queue_name" })
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("queue_name", { ascending: true });

  if (error) throwSupabaseError(error);
  return (data ?? []) as SmsQueueRow[];
}

export async function listSmsInbox(): Promise<SmsInboxResult> {
  const supabase = adminClient();
  const queues = await ensureSmsQueues();

  const { data, error } = await supabase
    .from("sms_threads")
    .select("*")
    .neq("status", "RESOLVED")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throwSupabaseError(error);

  const queueNameById = new Map(queues.map((q) => [q.id, q.queue_name]));
  const threads = ((data ?? []) as SmsThreadRow[]).map((thread) => {
    const queue_name = thread.current_queue_id
      ? queueNameById.get(thread.current_queue_id) ?? null
      : null;
    return { ...thread, queue_name } satisfies SmsThreadWithQueue;
  });
  const unreadCount = threads.reduce(
    (total, thread) => total + (thread.unread_for_agent ?? 0),
    0
  );

  return { queues, threads, unreadCount };
}

export async function listSmsMessages(threadId: string): Promise<SmsMessageRow[]> {
  const id = cleanRequired(threadId, "threadId");
  const supabase = adminClient();

  const { data, error } = await supabase
    .from("sms_messages")
    .select("*")
    .eq("thread_id", id)
    .order("created_at", { ascending: true });

  if (error) throwSupabaseError(error);
  return (data ?? []) as SmsMessageRow[];
}

export async function recordInboundSms(input: {
  customerPhone: string;
  messageBody: string;
  textbeeMessageId: string | null;
  receivedAt: string;
}): Promise<{ thread: SmsThreadRow; message: SmsMessageRow }> {
  const customerPhone = cleanRequired(input.customerPhone, "customerPhone");
  const messageBody = cleanRequired(input.messageBody, "messageBody");
  const supabase = adminClient();
  await ensureSmsQueues();
  const queue = await requireQueue(supabase, null);

  const { thread } = await getOrCreateThreadForPhone(supabase, {
    customerPhone,
    queueId: queue.id,
    status: "QUEUED",
  });

  const message = await insertSmsMessage(supabase, {
    threadId: thread.id,
    direction: "INBOUND",
    messageBody,
    createdAt: input.receivedAt,
    textbeeMessageId: input.textbeeMessageId,
    textbeeStatus: "RECEIVED",
  });

  const nextStatus: SmsThreadStatus =
    thread.status === "ACTIVE" ? "ACTIVE" : "QUEUED";
  const updated = await updateThread(supabase, thread.id, {
    last_message_body: messageBody,
    last_message_at: input.receivedAt,
    status: nextStatus,
    unread_for_agent: (thread.unread_for_agent ?? 0) + 1,
    resolved_at: null,
  });

  return { thread: updated, message };
}

export async function resolveSmsActor(input: {
  user: User;
  roles: string[];
}): Promise<SmsActor> {
  const isSuperAdmin = input.roles.some((role) => roleMayRegisterAgents(role));
  const isAgent = input.roles.includes("agent");
  if (!isSuperAdmin && !isAgent) {
    throw new SmsServiceError(
      403,
      "Only super admins or agents may access SMS conversations."
    );
  }

  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSms();
  const profile = await getAgentProfileByUserIdInSupabase({
    supabaseUrl,
    serviceRoleKey,
    userId: input.user.id,
  });

  if (profile) {
    return {
      agentId: profile.id,
      agentName: profile.name || displayNameFromUser(input.user),
      isSuperAdmin,
    };
  }

  if (isSuperAdmin) {
    return {
      agentId: input.user.id,
      agentName: displayNameFromUser(input.user),
      isSuperAdmin,
    };
  }

  throw new SmsServiceError(
    403,
    "No agent record linked to this user. Ensure agents.user_id matches your Supabase Auth user id."
  );
}

export async function sendTextBeeSms(input: {
  recipient: string;
  message: string;
}): Promise<{ textbeeMessageId: string | null; response: unknown }> {
  const recipient = cleanRequired(input.recipient, "recipient");
  const message = cleanRequired(input.message, "message");
  const missing = getMissingTextBeeOutboundEnv();
  if (missing.length > 0) {
    throw new SmsServiceError(
      500,
      `Missing TextBee outbound env: ${missing.join(", ")}.`
    );
  }

  const config = getTextBeeConfig();
  const url = `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(
    config.deviceId
  )}/send-sms`;
  const body: Record<string, unknown> = {
    recipients: [recipient],
    message,
  };
  if (config.simSubscriptionId) {
    body.simSubscriptionId = config.simSubscriptionId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof parsed === "string" ? parsed : JSON.stringify(parsed ?? {});
    throw new SmsServiceError(
      502,
      `TextBee send failed with HTTP ${response.status}: ${detail.slice(0, 500)}`
    );
  }

  return {
    textbeeMessageId: normalizeTextBeeResponseId(parsed),
    response: parsed,
  };
}

async function insertAndSendOutbound(input: {
  supabase: SupabaseClient;
  thread: SmsThreadRow;
  actor: SmsActor;
  messageBody: string;
}): Promise<{ message: SmsMessageRow; thread: SmsThreadRow }> {
  const messageBody = cleanRequired(input.messageBody, "messageBody");
  let message = await insertSmsMessage(input.supabase, {
    threadId: input.thread.id,
    direction: "OUTBOUND",
    messageBody,
    senderAgentId: input.actor.agentId,
    senderAgentName: input.actor.agentName,
    textbeeStatus: "PENDING",
  });

  const updatedThread = await updateThread(input.supabase, input.thread.id, {
    last_message_body: messageBody,
    last_message_at: message.created_at,
    status: "ACTIVE",
    unread_for_agent: 0,
    resolved_at: null,
  });

  try {
    const sent = await sendTextBeeSms({
      recipient: input.thread.customer_phone,
      message: messageBody,
    });
    message = await updateMessageTextBeeStatus(input.supabase, message.id, {
      textbeeMessageId: sent.textbeeMessageId,
      textbeeStatus: "SENT",
    });
  } catch (e) {
    await updateMessageTextBeeStatus(input.supabase, message.id, {
      textbeeStatus: "FAILED",
    });
    throw e;
  }

  return { message, thread: updatedThread };
}

export async function startSmsThread(input: {
  customerPhone: string;
  messageBody: string;
  queueId: string | null;
  actor: SmsActor;
}): Promise<{ thread: SmsThreadRow; message: SmsMessageRow }> {
  const customerPhone = cleanRequired(input.customerPhone, "customerPhone");
  const supabase = adminClient();
  await ensureSmsQueues();
  const queue = await requireQueue(supabase, input.queueId);

  let { thread } = await getOrCreateThreadForPhone(supabase, {
    customerPhone,
    queueId: queue.id,
    status: "ACTIVE",
    actor: input.actor,
  });

  thread = await updateThread(supabase, thread.id, {
    current_queue_id: queue.id,
    assigned_agent_id: input.actor.agentId,
    assigned_agent_name: input.actor.agentName,
    status: "ACTIVE",
    unread_for_agent: 0,
    resolved_at: null,
  });

  return insertAndSendOutbound({
    supabase,
    thread,
    actor: input.actor,
    messageBody: input.messageBody,
  });
}

export async function claimSmsThread(input: {
  threadId: string;
  actor: SmsActor;
}): Promise<SmsThreadRow> {
  const threadId = cleanRequired(input.threadId, "threadId");
  const supabase = adminClient();
  const thread = await getThreadById(supabase, threadId);
  if (!thread) throw new SmsServiceError(404, "SMS thread not found.");

  return updateThread(supabase, thread.id, {
    assigned_agent_id: input.actor.agentId,
    assigned_agent_name: input.actor.agentName,
    status: "ACTIVE",
    unread_for_agent: 0,
    resolved_at: null,
  });
}

export async function sendSmsThreadMessage(input: {
  threadId: string;
  messageBody: string;
  actor: SmsActor;
}): Promise<{ thread: SmsThreadRow; message: SmsMessageRow }> {
  const threadId = cleanRequired(input.threadId, "threadId");
  const supabase = adminClient();
  const thread = await getThreadById(supabase, threadId);
  if (!thread) throw new SmsServiceError(404, "SMS thread not found.");
  if (thread.status === "RESOLVED") {
    throw new SmsServiceError(409, "SMS thread is resolved. Reopen or start it before sending.");
  }
  if (!thread.assigned_agent_id) {
    throw new SmsServiceError(409, "SMS thread must be claimed before sending.");
  }
  if (!input.actor.isSuperAdmin && thread.assigned_agent_id !== input.actor.agentId) {
    throw new SmsServiceError(403, "SMS thread is claimed by another agent.");
  }

  return insertAndSendOutbound({
    supabase,
    thread,
    actor: input.actor,
    messageBody: input.messageBody,
  });
}

export async function resolveSmsThread(input: {
  threadId: string;
  actor: SmsActor;
}): Promise<SmsThreadRow> {
  const threadId = cleanRequired(input.threadId, "threadId");
  const supabase = adminClient();
  const thread = await getThreadById(supabase, threadId);
  if (!thread) throw new SmsServiceError(404, "SMS thread not found.");
  if (!input.actor.isSuperAdmin && thread.assigned_agent_id !== input.actor.agentId) {
    throw new SmsServiceError(403, "SMS thread is claimed by another agent.");
  }

  return updateThread(supabase, thread.id, {
    status: "RESOLVED",
    unread_for_agent: 0,
    resolved_at: new Date().toISOString(),
  });
}

export async function deleteSmsThread(input: {
  threadId: string;
  actor: SmsActor;
}): Promise<{ thread: SmsThreadRow; deletedMessageCount: number }> {
  const threadId = cleanRequired(input.threadId, "threadId");
  const supabase = adminClient();
  const thread = await getThreadById(supabase, threadId);
  if (!thread) throw new SmsServiceError(404, "SMS thread not found.");

  if (!input.actor.isSuperAdmin) {
    throw new SmsServiceError(403, "Only super admins may delete SMS threads.");
  }

  const { count, error: countError } = await supabase
    .from("sms_messages")
    .select("*", { count: "exact", head: true })
    .eq("thread_id", threadId);

  if (countError) throwSupabaseError(countError);

  const { error: messagesError } = await supabase
    .from("sms_messages")
    .delete()
    .eq("thread_id", threadId);

  if (messagesError) throwSupabaseError(messagesError);

  const { error: threadError } = await supabase
    .from("sms_threads")
    .delete()
    .eq("id", threadId);

  if (threadError) throwSupabaseError(threadError);

  return {
    thread,
    deletedMessageCount: count ?? 0,
  };
}
