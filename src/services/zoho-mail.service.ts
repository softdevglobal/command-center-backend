type ZohoRecord = Record<string, unknown>;

export interface SophieMailItem {
  messageId: string;
  threadId: string;
  folderId: string;
  mailboxFolder: "inbox" | "sent";
  fromAddress: string;
  toAddress: string;
  subject: string;
  summary: string;
  receivedTime: string | null;
  control: { state: "sophie" | "human"; ownerId: string | null };
}

export interface SophieMailContent {
  messageId: string;
  content: string;
}

let cachedAccessToken: string | null = null;
let accessTokenExpiresAt = 0;
let cachedAccountId: string | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Sophie Mail is not configured (${name}).`);
  return value;
}

function apiBase(): string {
  return (process.env.ZOHO_MAIL_API_BASE_URL?.trim() || "https://mail.zoho.com.au/api").replace(/\/+$/, "");
}

function asRecord(value: unknown): ZohoRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ZohoRecord : {};
}

function unwrapData(value: unknown): unknown {
  const root = asRecord(value);
  return root.data ?? value;
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60_000) return cachedAccessToken;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: requiredEnv("ZOHO_MAIL_CLIENT_ID"),
    client_secret: requiredEnv("ZOHO_MAIL_CLIENT_SECRET"),
    refresh_token: requiredEnv("ZOHO_MAIL_REFRESH_TOKEN"),
  });
  const response = await fetch(`${requiredEnv("ZOHO_MAIL_ACCOUNTS_URL")}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const result = asRecord(await response.json().catch(() => ({})));
  const token = typeof result.access_token === "string" ? result.access_token : "";
  if (!response.ok || !token) {
    console.error("[sophie-mail] OAuth refresh failed", { status: response.status, error: result.error ?? "invalid_response" });
    throw new Error("Could not connect to Sophie’s mailbox. Check Zoho Mail credentials and data-center configuration.");
  }
  cachedAccessToken = token;
  accessTokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
  return token;
}

async function zohoRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Zoho-oauthtoken ${token}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({}));
  const status = asRecord(asRecord(result).status);
  if (!response.ok || (typeof status.code === "number" && status.code >= 400)) {
    console.error("[sophie-mail] Zoho API request failed", { status: response.status, zohoCode: status.code ?? null });
    throw new Error("Zoho Mail could not complete the request. Check the mailbox scopes and configuration.");
  }
  return result;
}

async function resolveAccountId(): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  const raw = unwrapData(await zohoRequest("/accounts"));
  const accounts = Array.isArray(raw) ? raw : Array.isArray(asRecord(raw).accountList) ? asRecord(raw).accountList as unknown[] : [];
  const expectedEmail = (process.env.SOPHIE_EMAIL_ADDRESS ?? "sophie@bmspros.com.au").trim().toLowerCase();
  const account = accounts.map(asRecord).find((row) => {
    const email = String(row.primaryEmailAddress ?? row.emailAddress ?? row.accountName ?? "").toLowerCase();
    return email === expectedEmail;
  }) ?? accounts.map(asRecord)[0];
  const id = account?.accountId ?? account?.id;
  if (id === undefined || id === null) throw new Error("Zoho Mail did not return an account for Sophie’s mailbox.");
  cachedAccountId = String(id);
  return cachedAccountId;
}

async function resolveMailFolder(accountId: string, mailboxFolder: "inbox" | "sent"): Promise<string> {
  const raw = unwrapData(await zohoRequest(`/accounts/${encodeURIComponent(accountId)}/folders`));
  const folders = Array.isArray(raw) ? raw : Array.isArray(asRecord(raw).folderList) ? asRecord(raw).folderList as unknown[] : [];
  const wanted = mailboxFolder.toLowerCase();
  const match = folders.map(asRecord).find((folder) =>
    String(folder.folderType ?? "").toLowerCase() === wanted || String(folder.folderName ?? "").toLowerCase() === wanted,
  );
  const id = match?.folderId;
  if (id === undefined || id === null) throw new Error(`Zoho Mail could not find the ${mailboxFolder === "inbox" ? "Inbox" : "Sent"} folder.`);
  return String(id);
}

function messageList(raw: unknown): ZohoRecord[] {
  const data = asRecord(unwrapData(raw));
  const messages = data.messageList ?? data.messages ?? (Array.isArray(unwrapData(raw)) ? unwrapData(raw) : []);
  return Array.isArray(messages) ? messages.map(asRecord) : [];
}

function requiredString(record: ZohoRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "";
}

export async function listSophieInbox(
  controls: Map<string, { state: "sophie" | "human"; ownerId: string | null }>,
  limit = 50,
  mailboxFolder: "inbox" | "sent" = "inbox",
): Promise<SophieMailItem[]> {
  const accountId = await resolveAccountId();
  const folderId = await resolveMailFolder(accountId, mailboxFolder);
  const raw = await zohoRequest(`/accounts/${encodeURIComponent(accountId)}/messages/view?folderId=${encodeURIComponent(folderId)}&start=1&limit=${limit}`);
  return messageList(raw).map((message) => {
    const messageId = requiredString(message, "messageId");
    const threadId = requiredString(message, "threadId") || messageId;
    const messageTime = requiredString(message, "receivedTime", "sentDateInGMT");
    return {
      messageId,
      threadId,
      folderId: requiredString(message, "folderId") || folderId,
      mailboxFolder,
      fromAddress: requiredString(message, "fromAddress", "sender").slice(0, 320),
      toAddress: requiredString(message, "toAddress", "recipient").slice(0, 320),
      subject: requiredString(message, "subject").slice(0, 998),
      summary: requiredString(message, "summary", "snippet").slice(0, 1200),
      receivedTime: messageTime || null,
      control: controls.get(threadId) ?? { state: "sophie", ownerId: null },
    };
  }).filter((message) => message.messageId);
}

export async function getSophieMessageContent(folderId: string, messageId: string): Promise<SophieMailContent> {
  const accountId = await resolveAccountId();
  const raw = await zohoRequest(`/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`);
  const data = asRecord(unwrapData(raw));
  return { messageId, content: typeof data.content === "string" ? data.content.slice(0, 100_000) : "" };
}

export async function replyToSophieMessage(message: SophieMailItem, content: string): Promise<void> {
  const accountId = await resolveAccountId();
  await zohoRequest(`/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(message.messageId)}`, {
    method: "POST",
    body: JSON.stringify({
      fromAddress: (process.env.SOPHIE_EMAIL_ADDRESS ?? "sophie@bmspros.com.au").trim(),
      toAddress: message.fromAddress,
      subject: message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`,
      content,
      action: "reply",
      mailFormat: "plaintext",
      askReceipt: "no",
    }),
  });
}

export async function findSophieInboxMessage(messageId: string): Promise<SophieMailItem | null> {
  const messages = await listSophieInbox(new Map(), 200);
  return messages.find((message) => message.messageId === messageId) ?? null;
}
