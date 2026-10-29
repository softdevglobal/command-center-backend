import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type admin from "firebase-admin";
import { availablePinkPlans, createPinkBusinessProvisioner } from "../src/services/bms_pink/pink-onboarding.service.js";
import { missingOnboardingInformation, type OnboardingConfiguration } from "../src/services/ai/onboarding.schemas.js";
import { createOnboardingService, type OnboardingRecord, type OnboardingRepository } from "../src/services/ai/onboarding.service.js";
import { createLiveOnboardingTools } from "../src/services/ai/live-onboarding.service.js";

const terms = { version: "test-1", billingSummary: "Test only", privacySummary: "Test only", recording: "disabled" as const, retentionDays: 0, marketingEnabled: false as const };
const config: OnboardingConfiguration = {
  setupMode: "new_business", product: "pink", pinkBusinessType: "hair_salon", pinkPlanId: "starter", pinkPlanName: "Pink Starter",
  business: { tradingName: "Test Salon", ownerName: "Test Owner", ownerEmail: "owner@example.test", ownerPhone: "+61400000000",
    businessStructure: "sole_trader", gstRegistered: false, state: "VIC", postcode: "3000", timezone: "Australia/Melbourne" }, terms,
};
const plan = { name: "Pink Starter", price: 29, priceLabel: "AU$29 every 28 days", branches: 1, staff: 3, billingIntervalDays: 28, trialDays: 0, active: true, hidden: false };

function fixture() {
  const requestId = randomUUID(), uid = `ai-owner-${requestId.replace(/-/g, "")}`;
  const store = new Map<string, Record<string, unknown>>([["subscription_plans/starter", { ...plan }]]);
  const claims: Record<string, unknown>[] = [], email = { value: "owner@example.test" };
  let writes = 0, pending: Promise<unknown> = Promise.resolve(), claimFailure = false;
  type Ref = { path: string; id: string };
  const doc = (path: string): Ref => ({ path, id: path.split("/").at(-1)! });
  const snapshot = (ref: Ref) => ({ exists: store.has(ref.path), data: () => structuredClone(store.get(ref.path)) });
  const fakeDb = {
    doc,
    collection: () => ({ where: () => ({ limit: () => ({ query: true }) }) }),
    runTransaction<T>(run: (tx: unknown) => Promise<T>) {
      const result = pending.then(async () => {
        const staged: [Ref, Record<string, unknown>][] = [];
        const tx = { getAll: async (...refs: Ref[]) => refs.map(snapshot), get: async () => ({ empty: true }),
          create: (ref: Ref, value: Record<string, unknown>) => { if (store.has(ref.path)) throw new Error("Already exists"); staged.push([ref, value]); } };
        const value = await run(tx);
        for (const [ref, data] of staged) { store.set(ref.path, structuredClone(data)); writes++; }
        return value;
      });
      pending = result.catch(() => undefined); return result;
    },
  };
  const provision = createPinkBusinessProvisioner({ db: fakeDb as unknown as admin.firestore.Firestore,
    auth: { getUser: async () => ({ uid, email: email.value, disabled: false }) as admin.auth.UserRecord,
      setCustomUserClaims: async (_uid, value) => { if (claimFailure) { claimFailure = false; throw new Error("Claims update interrupted"); } claims.push(value!); } },
    now: () => new Date("2026-10-28T00:00:00Z"),
  });
  const input = { requestId, configuration: structuredClone(config), configurationHash: "approved-hash", approval: {
    ownerUid: uid, reviewedVersion: 2, termsVersion: "test-1", approvedAt: "2026-10-28T00:00:00Z", configurationHash: "approved-hash", method: "phone_confirmation" as const,
  } };
  return { input, store, uid, provision, claims, email, writes: () => writes, failClaims: () => { claimFailure = true; } };
}

test("Pink signup validates its own fields and does not require Black vehicle pricing, staff or branch setup", () => {
  assert.deepEqual(missingOnboardingInformation(config), []);
  const missing = missingOnboardingInformation({ ...config, pinkPlanId: undefined, pinkBusinessType: undefined });
  assert.ok(missing.includes("pinkPlanId")); assert.ok(missing.includes("pinkBusinessType"));
  assert.ok(!missing.includes("services")); assert.ok(!missing.includes("staff"));
  assert.ok(missingOnboardingInformation({ ...config, setupMode: "existing_business" }).includes("supported_setup_mode:pink_new_business_only"));
});

test("Pink plan catalog excludes hidden/inactive plans and fails closed on provider errors", async () => {
  const plans = await availablePinkPlans(async () => Response.json({ success: true, plans: [
    { ...plan, id: "starter" }, { ...plan, id: "hidden", hidden: true }, { ...plan, id: "inactive", active: false },
  ] }));
  assert.deepEqual(plans.map(item => item.id), ["starter"]);
  await assert.rejects(availablePinkPlans(async () => Response.json({ success: true, plans: [] })));
  await assert.rejects(availablePinkPlans(async () => new Response("unavailable", { status: 503 })));
});

test("Pink provisioning atomically creates its signup profile once and concurrent retries reuse it", async () => {
  const f = fixture();
  const results = await Promise.all([f.provision(f.input), f.provision(f.input)]);
  assert.deepEqual(results.map(result => result.created), [true, false]);
  const profile = f.store.get(`users/${f.uid}`)!;
  assert.equal(profile.role, "salon_owner"); assert.equal(profile.name, "Test Salon"); assert.equal(profile.businessType, "hair_salon");
  assert.equal(profile.planId, "starter"); assert.equal(profile.billingCycle, "Monthly");
  assert.equal(profile.accountStatus, "pending_payment"); assert.equal(profile.currentBranchCount, 0);
  assert.equal(profile.currentStaffCount, 0); assert.equal(profile.hasFreeTrial, false);
  assert.equal(f.writes(), 2); assert.equal(f.claims.at(-1)?.role, "salon_owner");
  assert.ok(![...f.store.keys()].some(key => key.startsWith("branches/") || key.startsWith("services/")));
});

test("only the selected plan's verified trial settings can grant a Pink signup trial", async () => {
  const f = fixture(); f.store.set("subscription_plans/starter", { ...plan, trialDays: 7 });
  await f.provision(f.input);
  const profile = f.store.get(`users/${f.uid}`)!;
  assert.equal(profile.accountStatus, "active_trial"); assert.equal(profile.trialDays, 7);
  assert.equal((profile.trial_end as Date).toISOString(), "2026-11-04T00:00:00.000Z");
});

test("Pink retries repair interrupted Auth claims without creating another profile", async () => {
  const f = fixture(); f.failClaims();
  await assert.rejects(f.provision(f.input));
  assert.equal(f.writes(), 2);
  assert.equal((await f.provision(f.input)).created, false);
  assert.equal(f.writes(), 2); assert.equal(f.claims.length, 1);
});

test("Pink completed checkpoints reject a deleted or reassigned owner profile", async () => {
  const f = fixture(); await f.provision(f.input);
  f.store.delete(`users/${f.uid}`);
  await assert.rejects(f.provision(f.input));
  assert.equal(f.writes(), 2);
});

test("Pink rejects hidden or changed plans, changed approval and unrelated existing owner records before writes", async () => {
  for (const mode of ["hidden", "plan-name", "approval", "email", "existing-owner"] as const) {
    const f = fixture();
    if (mode === "hidden") f.store.set("subscription_plans/starter", { ...plan, hidden: true });
    if (mode === "plan-name") f.input.configuration.pinkPlanName = "Invented Plan";
    if (mode === "approval") f.input.approval.configurationHash = "different-hash";
    if (mode === "email") f.email.value = "another@example.test";
    if (mode === "existing-owner") f.store.set(`users/${f.uid}`, { role: "salon_owner", name: "Existing" });
    await assert.rejects(f.provision(f.input)); assert.equal(f.writes(), 0);
  }
});

test("a changed Pink configuration cannot reuse a completed provisioning request", async () => {
  const f = fixture(); await f.provision(f.input);
  await assert.rejects(f.provision({ ...f.input, configurationHash: "new-hash", approval: { ...f.input.approval, configurationHash: "new-hash" } }));
  assert.equal(f.writes(), 2);
});

test("Pink voice onboarding saves one call-bound draft, requires explicit confirmation and invokes only Pink provisioning", async context => {
  const records = new Map<string, OnboardingRecord>(); let attempts = 0, notices = 0;
  const repository: OnboardingRepository = {
    get: async id => structuredClone(records.get(id) ?? null),
    insert: async row => { records.set(row.id, structuredClone(row)); return structuredClone(row); },
    replace: async (previous, next) => { if (records.get(previous.id)?.version !== previous.version) return null; records.set(next.id, structuredClone(next)); return structuredClone(next); },
  };
  context.mock.method(globalThis, "fetch", async () => Response.json({ success: true, plans: [{ ...plan, id: "starter" }] }));
  const service = createOnboardingService({ repository, getMapping: async () => null, provision: async () => { throw new Error("Black provisioning must not run"); },
    prepareOwnerAccount: async input => ({ uid: `ai-owner-${input.draftId.replace(/-/g, "")}`, loginUrl: "https://pink.bmspros.com.au/login" }),
    provisionPinkBusiness: async input => { attempts++; return { status: "ACCOUNT_CREATED", ownerUid: input.approval.ownerUid, slug: "test-salon", created: true }; },
    notifyAccountSetup: async () => { notices++; return { sms: { status: "sent" }, email: { status: "sent" } }; },
  });
  const live = await createLiveOnboardingTools({ service, sessionId: "pink-call", operatorId: "operator", terms, authorizeOperator: async () => {}, isEnabled: () => true });
  assert.ok(live.instructions.length <= 20000);
  assert.ok(live.tools.some(tool => tool.name === "get_available_pink_subscription_plans"));
  const { terms: _terms, ...facts } = config;
  const saved = await live.execute("save_onboarding_draft", { configuration: facts });
  assert.deepEqual(saved.missingInformation, []);
  assert.ok("availablePinkPlans" in saved);
  await assert.rejects(live.execute("complete_business_onboarding", { callerConfirmedDetails: true, callerConfirmedAccountCreation: false }));
  assert.equal(attempts, 0);
  const result = await live.execute("complete_business_onboarding", { callerConfirmedDetails: true, callerConfirmedAccountCreation: true });
  assert.equal(result.businessProvisioned, true); assert.equal(result.loginUrl, "https://pink.bmspros.com.au/login");
  assert.equal(result.liveCallsActivated, false); assert.equal(attempts, 1); assert.equal(notices, 1);
  await live.execute("complete_business_onboarding", { callerConfirmedDetails: true, callerConfirmedAccountCreation: true });
  assert.equal(attempts, 1); assert.equal(records.size, 1);
});
