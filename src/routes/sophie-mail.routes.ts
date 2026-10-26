import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSuperAdminRoleForInsert } from "../config/supabase-app-role.js";
import { requireSuperAdminOrSetup } from "../middleware/super-admin-or-setup.middleware.js";
import { createSupabaseClient, getSupabaseProjectUrl, getSupabaseServiceRoleKey } from "../db/supabase/supabase.client.js";
import { findSophieInboxMessage, getSophieMessageContent, listSophieInbox, replyToSophieMessage } from "../services/zoho-mail.service.js";
import { businessKnowledgeSchema, listBusinessKnowledge, saveBusinessKnowledge } from "../services/ai/sophie-business-knowledge.service.js";

const router = Router();
const controlSchema = z.object({ state: z.enum(["sophie", "human"]) });
const replySchema = z.object({ content: z.string().trim().min(1).max(20_000) });

function adminClient() {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) throw new Error("Supabase admin storage is not configured.");
  return createSupabaseClient(url, key);
}

function actorId(res: import("express").Response): string | null {
  const auth = res.locals.superAdminAuth;
  const roles = new Set([getSuperAdminRoleForInsert(), "super_admin", "super-admin", "superadmin"]);
  if (auth?.kind !== "bearer" || !auth.roles.some((role: string) => roles.has(role))) return null;
  return auth.user.id;
}

router.use(requireSuperAdminOrSetup, (_req, res, next) => {
  if (!actorId(res)) { res.status(403).json({ error: "Sign in as a super admin to access Sophie Mail." }); return; }
  next();
});

router.get("/knowledge", async (_req, res) => {
  try { res.json({ data: await listBusinessKnowledge() }); }
  catch (error) {
    console.error("[sophie-mail] Business information load failed", error instanceof Error ? error.message : "unknown");
    res.status(503).json({ error: "Could not load business information. Check that its database migration has been applied." });
  }
});

router.post("/knowledge", async (req, res) => {
  const parsed = businessKnowledgeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid business information." }); return; }
  try { res.status(201).json({ data: await saveBusinessKnowledge(randomUUID(), parsed.data, actorId(res)!) }); }
  catch { res.status(503).json({ error: "Could not save business information." }); }
});

router.put("/knowledge/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = businessKnowledgeSchema.safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: "Invalid business information." }); return; }
  try { res.json({ data: await saveBusinessKnowledge(id.data, parsed.data, actorId(res)!) }); }
  catch { res.status(503).json({ error: "Could not save business information." }); }
});

router.get("/threads", async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
  const mailboxFolder = req.query.folder === undefined || req.query.folder === "inbox" ? "inbox" : req.query.folder === "sent" ? "sent" : null;
  if (!mailboxFolder) { res.status(400).json({ error: "Folder must be inbox or sent." }); return; }
  try {
    const { data, error } = await adminClient().from("sophie_mail_thread_controls").select("thread_id,state,owner_id");
    if (error) throw error;
    const controls = new Map((data ?? []).map((row: { thread_id: string; state: "sophie" | "human"; owner_id: string | null }) => [row.thread_id, { state: row.state, ownerId: row.owner_id }]));
    res.json({ data: await listSophieInbox(controls, limit, mailboxFolder) });
  } catch (error) {
    console.error("[sophie-mail] Inbox load failed", error instanceof Error ? error.message : "unknown");
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not load Sophie’s inbox." });
  }
});

router.get("/messages/:messageId/content", async (req, res) => {
  const messageId = String(req.params.messageId ?? "");
  const folderId = typeof req.query.folderId === "string" ? req.query.folderId : "";
  if (!/^\d{6,30}$/.test(messageId) || !/^\d{6,30}$/.test(folderId)) { res.status(400).json({ error: "Invalid message or folder ID." }); return; }
  try {
    const message = await getSophieMessageContent(folderId, messageId);
    res.json(message);
  } catch (error) {
    console.error("[sophie-mail] Message content load failed", error instanceof Error ? error.message : "unknown");
    res.status(503).json({ error: "Could not load this email." });
  }
});

router.put("/threads/:threadId/control", async (req, res) => {
  const threadId = String(req.params.threadId ?? "");
  const parsed = controlSchema.safeParse(req.body);
  if (!/^\d{6,30}$/.test(threadId) || !parsed.success) { res.status(400).json({ error: "Invalid thread control request." }); return; }
  const userId = actorId(res)!;
  const state = parsed.data.state;
  try {
    const client = adminClient();
    const { error } = await client.from("sophie_mail_thread_controls").upsert({
      thread_id: threadId,
      state,
      owner_id: state === "human" ? userId : null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "thread_id" });
    if (error) throw error;
    const audit = await client.from("sophie_mail_audit_events").insert({
      thread_id: threadId,
      actor_id: userId,
      action: state === "human" ? "takeover" : "release_to_sophie",
      details: {},
    });
    if (audit.error) console.error("[sophie-mail] Takeover audit write failed", audit.error.message);
    res.json({ threadId, state, ownerId: state === "human" ? userId : null });
  } catch (error) {
    console.error("[sophie-mail] Thread control update failed", error instanceof Error ? error.message : "unknown");
    res.status(503).json({ error: "Could not update thread control." });
  }
});

router.post("/messages/:messageId/reply", async (req, res) => {
  const messageId = String(req.params.messageId ?? "");
  const parsed = replySchema.safeParse(req.body);
  if (!/^\d{6,30}$/.test(messageId) || !parsed.success) { res.status(400).json({ error: "Invalid reply request." }); return; }
  const userId = actorId(res)!;
  try {
    const message = await findSophieInboxMessage(messageId);
    if (!message) { res.status(404).json({ error: "That email is no longer in Sophie’s Inbox." }); return; }
    const client = adminClient();
    const { data: control, error: controlError } = await client.from("sophie_mail_thread_controls").select("state").eq("thread_id", message.threadId).maybeSingle();
    if (controlError) throw controlError;
    if (control?.state !== "human") { res.status(409).json({ error: "Take over this email thread before replying." }); return; }
    await replyToSophieMessage(message, parsed.data.content);
    const audit = await client.from("sophie_mail_audit_events").insert({
      thread_id: message.threadId,
      actor_id: userId,
      action: "human_reply_sent",
      details: { message_id: messageId },
    });
    if (audit.error) console.error("[sophie-mail] Reply audit write failed", audit.error.message);
    res.status(202).json({ sent: true, auditRecorded: !audit.error });
  } catch (error) {
    console.error("[sophie-mail] Reply failed", error instanceof Error ? error.message : "unknown");
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not send the reply." });
  }
});

export default router;
