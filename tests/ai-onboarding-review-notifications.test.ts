import assert from "node:assert/strict";
import test from "node:test";
import { createReviewNotifier, reviewSmsRecipient, reviewNoticeProviders, type ReviewChannel, type ReviewDelivery, type ReviewNotice, type ReviewNoticeStore } from "../src/services/ai/onboarding-review-notification.service.js";

const notice: ReviewNotice = { draftId: "test-draft", configurationHash: "config-a", reviewUrl: "https://black.bmspros.com.au/onboarding/test-draft", ownerEmail: "owner@example.test", ownerPhone: "+61400000000" };
function fixture() {
  const records = new Map<string, { status: "processing" | "accepted" | "failed" | "unknown"; code: string | null; created_at: string }>();
  const key = (input: Pick<ReviewNotice, "draftId" | "configurationHash">, channel: ReviewChannel) => `${input.draftId}:${input.configurationHash}:${channel}`;
  const calls: Array<{ channel: ReviewChannel; recipient: string; url: string }> = [];
  const store: ReviewNoticeStore = {
    async claim(input, channel) {
      const id = key(input, channel);
      if (records.has(id)) return false;
      records.set(id, { status: "processing", code: null, created_at: new Date().toISOString() }); return true;
    },
    async read(input, channel) { return records.get(key(input, channel)) ?? null; },
    async finish(input, channel, result) {
      const previous = records.get(key(input, channel))!;
      assert.ok(["accepted", "failed", "unknown"].includes(result.status));
      records.set(key(input, channel), { ...previous, status: result.status as "accepted" | "failed" | "unknown", code: result.code ?? null });
    },
  };
  let enabled = true, smsFails = false;
  const providers = {
    configured: () => enabled,
    async send(channel: ReviewChannel, recipient: string, url: string): Promise<ReviewDelivery> {
      calls.push({ channel, recipient, url });
      if (channel === "sms" && smsFails) throw new Error("Private provider details must not escape");
      return { status: "accepted" };
    },
  };
  return { store, providers, records, calls, notifier: createReviewNotifier(store, providers),
    disable: () => { enabled = false; }, failSms: () => { smsFails = true; } };
}

test("both channels receive the exact product review URL once across concurrent submission and restart", async () => {
  const f = fixture();
  await Promise.all([f.notifier.notify(notice), f.notifier.notify(notice)]);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.find(call => call.channel === "sms"), { channel: "sms", recipient: notice.ownerPhone, url: notice.reviewUrl });
  assert.equal(f.calls.find(call => call.channel === "email")?.recipient, notice.ownerEmail);
  const restarted = createReviewNotifier(f.store, f.providers);
  const repeated = await restarted.notify(notice);
  assert.equal(repeated.sms.status, "accepted"); assert.equal(repeated.email.status, "accepted");
  assert.equal(f.calls.length, 2);
  const trade = { ...notice, configurationHash: "config-b", reviewUrl: "https://trade.bmspros.com.au/onboarding/test-draft" };
  await restarted.notify(trade);
  assert.ok(f.calls.slice(2).every(call => call.url === trade.reviewUrl));
});

test("an uncertain SMS does not block email and is never automatically resent", async () => {
  const f = fixture(); f.failSms();
  const result = await f.notifier.notify(notice);
  assert.deepEqual(result.sms, { status: "unknown", code: "PROVIDER_OUTCOME_UNKNOWN" });
  assert.equal(result.email.status, "accepted");
  await f.notifier.notify(notice);
  assert.equal(f.calls.length, 2);
});

test("missing providers and invalid phones report truthful status without sending", async () => {
  const f = fixture(); f.disable();
  const result = await f.notifier.notify(notice);
  assert.equal(result.sms.status, "not_configured"); assert.equal(result.email.status, "not_configured");
  assert.equal(f.calls.length, 0);
  const g = fixture();
  const invalid = await g.notifier.notify({ ...notice, ownerPhone: "0400000000" });
  assert.equal(invalid.sms.status, "invalid_recipient"); assert.equal(invalid.email.status, "accepted");
  assert.equal(g.calls.length, 1);
  assert.equal(reviewSmsRecipient("+61 (400) 000-000"), "+61400000000");
});

test("storage failure prevents untracked sends; interrupted claims are unknown without resending", async () => {
  const f = fixture();
  const broken = createReviewNotifier({ ...f.store, async claim() { throw new Error("database down"); } }, f.providers);
  const result = await broken.notify(notice);
  assert.equal(result.sms.status, "storage_unavailable"); assert.equal(f.calls.length, 0);
  await f.store.claim(notice, "sms");
  f.records.get(`${notice.draftId}:${notice.configurationHash}:sms`)!.created_at = new Date(Date.now() - 120000).toISOString();
  const retried = await f.notifier.notify(notice);
  assert.equal(retried.sms.status, "unknown");
  assert.equal(f.calls.filter(call => call.channel === "sms").length, 0);
});

test("local review URLs are not sent to owners", async () => {
  const f = fixture();
  const result = await f.notifier.notify({ ...notice, reviewUrl: "http://localhost:3000/onboarding/test-draft" });
  assert.equal(result.sms.status, "failed"); assert.equal(result.email.status, "failed");
  assert.equal(f.calls.length, 0);
});

test("provider requests use existing TextBee and ZeptoMail settings and never expose private response bodies", async context => {
  const settings = { TEXTBEE_API_KEY: "fake-sms-key", TEXTBEE_DEVICE_ID: "fake-device", ZEPTOMAIL_SYSTEM_TOKEN: "fake-email-token", ZEPTOMAIL_SYSTEM_FROM_ADDRESS: "noreply@example.test", ZEPTOMAIL_URL: "https://api.zeptomail.com.au/v1.1/email" };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  context.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const requests: Array<{ url: string; headers: Headers; body: Record<string, any> }> = [];
  let status = 200;
  context.mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    assert.ok(init.signal);
    return new Response("private provider details", { status });
  });
  assert.equal((await reviewNoticeProviders.send("sms", notice.ownerPhone, notice.reviewUrl)).status, "accepted");
  assert.equal(requests[0]?.headers.get("x-api-key"), settings.TEXTBEE_API_KEY);
  assert.deepEqual(requests[0]?.body.recipients, [notice.ownerPhone]);
  assert.ok(requests[0]?.body.message.includes(notice.reviewUrl));
  assert.equal((await reviewNoticeProviders.send("email", notice.ownerEmail, notice.reviewUrl)).status, "accepted");
  assert.equal(requests[1]?.headers.get("authorization"), "Zoho-enczapikey fake-email-token");
  assert.equal(requests[1]?.body.to[0].email_address.address, notice.ownerEmail);
  assert.ok(requests[1]?.body.htmlbody.includes(notice.reviewUrl));
  status = 401;
  assert.deepEqual(await reviewNoticeProviders.send("email", notice.ownerEmail, notice.reviewUrl), { status: "failed", code: "EMAIL_HTTP_401" });
  status = 503;
  assert.deepEqual(await reviewNoticeProviders.send("sms", notice.ownerPhone, notice.reviewUrl), { status: "unknown", code: "SMS_HTTP_503" });
});
