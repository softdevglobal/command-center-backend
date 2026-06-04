import { Router, type Request, type Response } from "express";

import { getTextBeeConfig } from "../config/textbee.js";
import { attachSupabaseUser } from "../middleware/supabase-auth.middleware.js";
import { emitSmsUpdated } from "../realtime/sms-events.js";
import { sessionSummaryFromLocals } from "../services/auth/supabase-auth.service.js";
import {
  createSmsContact,
  deleteSmsContact,
  getSmsContactById,
  listSmsContacts,
  updateSmsContact,
} from "../services/sms-contacts.service.js";
import {
  claimSmsThread,
  deleteSmsThread,
  listSmsInbox,
  listSmsMessages,
  recordInboundSms,
  resolveSmsActor,
  resolveSmsThread,
  sendSmsThreadMessage,
  SmsServiceError,
  startSmsThread,
} from "../services/sms.service.js";
import type {
  SmsContactInput,
  SmsContactListFilters,
  SmsContactType,
  SmsContactUpdateInput,
} from "../types/sms-contact.types.js";
import type { NormalizedTextBeeInbound } from "../types/sms.types.js";

const router = Router();

function bodyRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function firstPayloadValue(
  payload: Record<string, unknown>,
  keys: readonly string[]
): unknown {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function valueToTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value.trim());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  return new Date().toISOString();
}

function normalizeTextBeePayload(
  body: unknown
): NormalizedTextBeeInbound | { error: string } {
  const payload = bodyRecord(body);
  if (!payload) {
    return { error: "Webhook body must be a JSON object." };
  }

  const phone = valueToString(
    firstPayloadValue(payload, ["sender", "from", "phone", "customerPhone"])
  );
  const message = valueToString(
    firstPayloadValue(payload, ["message", "text", "body", "content"])
  );
  const smsId = valueToString(firstPayloadValue(payload, ["smsId", "id"]));
  const receivedAt = valueToTimestamp(
    firstPayloadValue(payload, ["receivedAt", "timestamp"])
  );

  if (!phone) return { error: "Webhook payload is missing sender/from/phone/customerPhone." };
  if (!message) return { error: "Webhook payload is missing message/text/body/content." };

  return { phone, message, smsId, receivedAt };
}

function requestWebhookSecret(req: Request): string {
  const headerSecret =
    req.get("x-textbee-secret")?.trim() || req.get("x-webhook-secret")?.trim();
  if (headerSecret) return headerSecret;

  const querySecret = req.query.secret;
  if (typeof querySecret === "string") return querySecret.trim();
  if (Array.isArray(querySecret) && typeof querySecret[0] === "string") {
    return querySecret[0].trim();
  }
  return "";
}

function sendRouteError(
  res: Response,
  e: unknown,
  fallback: string
): void {
  if (e instanceof SmsServiceError) {
    res.status(e.status).json({ success: false, error: e.message });
    return;
  }

  const msg = e instanceof Error ? e.message : fallback;
  res.status(500).json({ success: false, error: msg });
}

function authExtras(res: Response) {
  const auth = res.locals.supabaseAuth;
  if (!auth) return {};
  return {
    authenticatedAs: sessionSummaryFromLocals({
      user: auth.user,
      roles: auth.roles,
    }),
  };
}

function parseStartBody(
  body: unknown
): { customerPhone: string; messageBody: string; queueId: string | null } | { error: string } {
  const record = bodyRecord(body);
  if (!record) return { error: "Request body must be a JSON object." };

  const customerPhone = valueToString(record.customerPhone);
  const messageBody = valueToString(record.messageBody);
  const queueId = valueToString(record.queueId);

  if (!customerPhone) return { error: "customerPhone is required." };
  if (!messageBody) return { error: "messageBody is required." };

  return { customerPhone, messageBody, queueId };
}

function parseMessageBody(body: unknown): { messageBody: string } | { error: string } {
  const record = bodyRecord(body);
  if (!record) return { error: "Request body must be a JSON object." };

  const messageBody = valueToString(record.messageBody);
  if (!messageBody) return { error: "messageBody is required." };

  return { messageBody };
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function queryInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function paramId(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function parseContactTypeFilter(value: unknown): SmsContactType | undefined {
  const raw = queryString(value);
  if (!raw) return undefined;
  if (raw === "customer" || raw === "owner") return raw;
  return undefined;
}

function parseContactListFilters(
  query: Record<string, unknown>
): SmsContactListFilters {
  const filters: SmsContactListFilters = {};
  const contactType =
    parseContactTypeFilter(query.contactType) ??
    parseContactTypeFilter(query.contact_type);
  const phone = queryString(query.phone);
  const ownerUid = queryString(query.ownerUid) ?? queryString(query.owner_uid);
  const search = queryString(query.search);
  const limit = queryInt(query.limit);
  const offset = queryInt(query.offset);

  if (contactType) filters.contactType = contactType;
  if (phone) filters.phone = phone;
  if (ownerUid) filters.ownerUid = ownerUid;
  if (search) filters.search = search;
  if (limit !== undefined) filters.limit = limit;
  if (offset !== undefined) filters.offset = offset;

  return filters;
}

function parseContactCreateBody(
  body: unknown
): SmsContactInput | { error: string } {
  const record = bodyRecord(body);
  if (!record) return { error: "Request body must be a JSON object." };

  const contactType =
    parseContactTypeFilter(record.contactType) ??
    parseContactTypeFilter(record.contact_type);
  const displayName =
    valueToString(record.displayName) ?? valueToString(record.display_name);
  const phone = valueToString(record.phone);
  const ownerUid =
    valueToString(record.ownerUid) ?? valueToString(record.owner_uid);

  if (!contactType) {
    return { error: "contactType is required and must be customer or owner." };
  }
  if (!displayName) return { error: "displayName is required." };
  if (!phone) return { error: "phone is required." };

  const parsed: SmsContactInput = { contactType, displayName, phone };
  if (ownerUid) parsed.ownerUid = ownerUid;
  return parsed;
}

function parseContactUpdateBody(
  body: unknown
): SmsContactUpdateInput | { error: string } {
  const record = bodyRecord(body);
  if (!record) return { error: "Request body must be a JSON object." };

  const patch: SmsContactUpdateInput = {};
  const contactType =
    parseContactTypeFilter(record.contactType) ??
    parseContactTypeFilter(record.contact_type);
  const displayName =
    valueToString(record.displayName) ?? valueToString(record.display_name);
  const phone = valueToString(record.phone);
  const ownerUidRaw = record.ownerUid ?? record.owner_uid;

  if (contactType) patch.contactType = contactType;
  if (displayName) patch.displayName = displayName;
  if (phone) patch.phone = phone;
  if (ownerUidRaw !== undefined) {
    patch.ownerUid =
      ownerUidRaw === null
        ? null
        : valueToString(ownerUidRaw);
  }

  if (Object.keys(patch).length === 0) {
    return { error: "Provide at least one field to update." };
  }

  return patch;
}

/**
 * POST /api/sms/textbee-webhook
 * TextBee inbound webhook. Secret is accepted from x-textbee-secret,
 * x-webhook-secret, or ?secret=...
 */
router.post("/textbee-webhook", async (req, res) => {
  const expectedSecret = getTextBeeConfig().webhookSecret;
  if (!expectedSecret) {
    res.status(500).json({
      success: false,
      error: "TEXTBEE_WEBHOOK_SECRET is not configured.",
    });
    return;
  }

  if (requestWebhookSecret(req) !== expectedSecret) {
    res.status(403).json({ success: false, error: "Invalid webhook secret." });
    return;
  }

  const normalized = normalizeTextBeePayload(req.body);
  if ("error" in normalized) {
    res.status(400).json({ success: false, error: normalized.error });
    return;
  }

  try {
    const result = await recordInboundSms({
      customerPhone: normalized.phone,
      messageBody: normalized.message,
      textbeeMessageId: normalized.smsId,
      receivedAt: normalized.receivedAt,
    });

    emitSmsUpdated({
      reason: "inbound",
      threadId: result.thread.id,
      messageId: result.message.id,
    });

    res.status(201).json({ success: true, data: result });
  } catch (e) {
    sendRouteError(res, e, "Failed to record inbound SMS.");
  }
});

router.use(attachSupabaseUser);

router.get("/inbox", async (_req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  try {
    await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const result = await listSmsInbox();
    res.json({ success: true, data: result, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to load SMS inbox.");
  }
});

router.get("/threads/:threadId/messages", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  try {
    await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const messages = await listSmsMessages(req.params.threadId ?? "");
    res.json({ success: true, data: messages, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to load SMS messages.");
  }
});

router.post("/threads/start", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const parsed = parseStartBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const actor = await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const result = await startSmsThread({
      customerPhone: parsed.customerPhone,
      messageBody: parsed.messageBody,
      queueId: parsed.queueId,
      actor,
    });

    emitSmsUpdated({
      reason: "thread_started",
      threadId: result.thread.id,
      messageId: result.message.id,
    });

    res.status(201).json({ success: true, data: result, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to start SMS thread.");
  }
});

router.post("/threads/:threadId/claim", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  try {
    const actor = await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const thread = await claimSmsThread({
      threadId: req.params.threadId ?? "",
      actor,
    });

    emitSmsUpdated({ reason: "thread_claimed", threadId: thread.id });

    res.json({ success: true, data: thread, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to claim SMS thread.");
  }
});

router.post("/threads/:threadId/messages", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const parsed = parseMessageBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const actor = await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const result = await sendSmsThreadMessage({
      threadId: req.params.threadId ?? "",
      messageBody: parsed.messageBody,
      actor,
    });

    emitSmsUpdated({
      reason: "message_sent",
      threadId: result.thread.id,
      messageId: result.message.id,
    });

    res.status(201).json({ success: true, data: result, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to send SMS message.");
  }
});

router.post("/threads/:threadId/resolve", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  try {
    const actor = await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const thread = await resolveSmsThread({
      threadId: req.params.threadId ?? "",
      actor,
    });

    emitSmsUpdated({ reason: "thread_resolved", threadId: thread.id });

    res.json({ success: true, data: thread, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to resolve SMS thread.");
  }
});

router.delete("/threads/:threadId", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  try {
    const actor = await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const result = await deleteSmsThread({
      threadId: req.params.threadId ?? "",
      actor,
    });

    emitSmsUpdated({ reason: "thread_deleted", threadId: result.thread.id });

    res.json({ success: true, data: result, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to delete SMS thread.");
  }
});

router.get("/contacts", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  try {
    await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const result = await listSmsContacts(
      parseContactListFilters(req.query as Record<string, unknown>)
    );
    res.json({ success: true, ...result, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to list SMS contacts.");
  }
});

router.get("/contacts/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const row = await getSmsContactById(id);
    if (!row) {
      res.status(404).json({ success: false, error: "SMS contact not found." });
      return;
    }
    res.json({ success: true, data: row, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to load SMS contact.");
  }
});

router.post("/contacts", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const parsed = parseContactCreateBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    const actor = await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const data = await createSmsContact({
      ...parsed,
      createdBy: actor.agentId,
    });
    res.status(201).json({ success: true, data, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to create SMS contact.");
  }
});

router.patch("/contacts/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  const parsed = parseContactUpdateBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  try {
    await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const data = await updateSmsContact(id, parsed);
    res.json({ success: true, data, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to update SMS contact.");
  }
});

router.delete("/contacts/:id", async (req, res) => {
  const auth = res.locals.supabaseAuth;
  if (!auth) {
    res.status(401).json({ success: false, error: "Unauthorized." });
    return;
  }

  const id = paramId(req.params.id).trim();
  if (!id) {
    res.status(400).json({ success: false, error: "id is required." });
    return;
  }

  try {
    await resolveSmsActor({ user: auth.user, roles: auth.roles });
    const data = await deleteSmsContact(id);
    res.json({ success: true, data, ...authExtras(res) });
  } catch (e) {
    sendRouteError(res, e, "Failed to delete SMS contact.");
  }
});

export default router;
