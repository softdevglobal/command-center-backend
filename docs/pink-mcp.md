# BMS Pink MCP front office

The Pink MCP endpoint is mounted at `/api/bms-pink/ai/mcp`. Its route and product-specific APIs live under `bms_pink`, alongside the Pink booking and catalog routes. It exposes the assigned branch profile, active services and date availability. Booking creation is advertised only when `AI_MCP_PINK_BOOKINGS_ENABLED=true`.

The backend resolves Pink from the Pink queue attached to the DID mapping. Create the Pink queue in Command Center and use **DID Routing → Pink DID Mappings** to assign each phone number to its Pink salon and branch. The mapping is the source of truth for product routing and salon assignment. Keep each DID unique across product mappings.

## Required backend settings

```env
AI_FEATURE_ENABLED=true
AI_VOICE_PROVIDER=yeastar
AI_MCP_ENABLED=true
AI_MCP_PINK_ENABLED=true
AI_MCP_PINK_BOOKINGS_ENABLED=false
FIREBASE_PINK_WEB_API_KEY=<Pink Firebase Web API key>
```

The backend authenticates the shared voice bridge bearer from `AI_VOICE_BRIDGE_SECRET`, reads the digits-only DID from `X-BMSPro-DID`, and resolves its queue, salon owner and branch from the shared DID mapping. No per-DID MCP tenant configuration is needed. The Pink AI UID is generated deterministically from the DID by the AI Receptionists screen.

The voice bridge uses its existing `BMSPRO_BRIDGE_SECRET` as the MCP bearer; it must match `AI_VOICE_BRIDGE_SECRET` in the backend. Keep booking writes disabled until the Pink AI identity and Pink call-center API are configured for the target salon. Enable `AI_MCP_PINK_BOOKINGS_ENABLED` only after a controlled end-to-end review.

## Pink AI identity

Create the Pink account from **AI Receptionists → BMS Pink** after mapping a DID. The backend creates a dedicated Firebase Pink identity, not a human owner's or staff member's account. Its `call_center_agents/{uid}` document is scoped to the mapped `did`, `ownerUid` and `branchId`, with `accountType: "ai-front-office"`, `brand: "pink"`, `role: "agent"`, `assignedWorkshops: [ownerUid]`, and `suspended: false`. Its Firebase custom claims include `aiFrontOffice: true` and `brand: "pink"`.

The endpoint verifies this identity and the returned branch on every request/tool operation. Create the identity through the Pink AI Receptionists tab before starting the MCP session. Each DID belongs to one mapped product, salon and branch.

## Pink business onboarding

The existing shared onboarding DID accepts Black, Trade or Pink. Select `product=pink` and `setupMode=new_business`. Pink-specific signup/provisioning logic is in `src/services/bms_pink/pink-onboarding.service.ts`; the existing shared call workflow manages the draft, confirmation and notifications. Pink-specific HTTP routes remain in `src/routes/bms_pink/`.

Collect the owner's name, email and phone; salon name; Pink business type; business structure; GST choice; Australian state and postcode; timezone; and the selected `pinkPlanId` and `pinkPlanName`. ABN and street address are optional. Branches, services, staff and schedules are configured after login, matching Pink's signup screen. Black vehicle pricing is not part of Pink signup.

`get_available_pink_subscription_plans` reads Pink's active public signup plans. The authenticated super-admin REST equivalent is `GET /api/bms-pink/onboarding/plans`. Account creation revalidates the selected plan against Pink Firestore inside the provisioning transaction. Hidden, inactive or renamed plans are rejected. The verified plan controls staff/branch limits, billing interval and any configured signup trial; onboarding does not charge a payment method.

`complete_business_onboarding` requires explicit confirmation of both the readback and account creation. It creates a dedicated Pink owner Auth identity and `users/{uid}` with `role=salon_owner`, matching existing Pink signup. A deterministic owner UID and transactional request checkpoint make retries reuse the same account. Existing unrelated accounts are rejected. Email/SMS setup messages use the existing private invitation ledger.

Deploy Pink admin's new `/account-setup` page before testing delivered setup links. The password reset action code stays in the URL fragment, is removed from browser history on load, and is never returned to the model. `PINK_ADMIN_BASE_URL` can override the Pink login/setup origin; it must be public HTTPS for setup notifications. `PINK_API_BASE_URL` controls catalog, availability and booking requests.

## Booking safeguards

`get_available_slots` accepts one service because Pink's current call-center contract exposes one appointment time. The backend filters past or unavailable times in the mapped branch's timezone and stores a five-minute salon/branch-scoped offer. This does not reserve the time. `create_booking` requires `customerConfirmed: true`, rechecks availability and claims a durable request key before submitting. Its upstream request includes `Idempotency-Key` and a bounded timeout. The stored result can be recovered by an identical retry even after the offer expires; changed details cannot reuse the key. An unfinished or uncertain request returns `UNKNOWN`; staff must verify it before another attempt. Only an explicit upstream `Confirmed` status becomes `CONFIRMED`; an identified successful booking with another status becomes `PENDING_REVIEW`.

After Pink confirms that the booking record was saved, the backend sends a customer receipt and a salon-owner alert by email and SMS, matching the Black/Trade AI notification behavior. Owner dashboard/push notifications remain handled by Pink's booking API. Delivery outcomes are saved per submission and channel in Pink Firestore (`ai_pink_booking_notifications`) so repeated tool calls do not duplicate accepted or uncertain sends. The MCP result includes each channel's provider status; `accepted` means the provider accepted the request, not guaranteed delivery. Australian national-format mobile numbers are normalized to `+61` before TextBee delivery.

Enable `AI_MCP_PINK_BOOKINGS_ENABLED=true` in the backend to advertise `create_booking`. The voice bridge discovers the advertised write tool automatically. Keep this flag off in environments that must not submit real bookings.

## Checks

`npm run test:ai` includes Pink onboarding/provisioning and booking tests using in-memory storage and mocked upstream writes. They cover confirmation, mapping scope, active-plan checks, concurrent retries, changed details, expired offers, availability changes, uncertain results and write-tool gating. Bridge tests cover Pink startup, branch identity, service/slot prerequisites and duplicate submission prevention. Read-only live checks validate public plans, the mapped profile/services and upstream availability; they do not create an owner or booking.

The MCP does not create customer accounts or collect passwords. Pink customer registration remains in its secure web flow. Command Center exposes Pink salon/branch mappings and dedicated receptionist provisioning through its super-admin APIs.
