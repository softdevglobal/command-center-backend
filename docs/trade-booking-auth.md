# Protected Trade bookings

Trade MCP and Command Center Blue booking routes now use Trade's authenticated
`/api/call-center/bookings` endpoints, not the public customer booking API.
Keep `AI_MCP_TRADE_REQUESTS_ENABLED=false` during rollout. Deploy Trade before
deploying this backend change, create the mapped AI accounts, and verify reads
before enabling writes again. There is no guest fallback.

## Setup

1. Deploy the new Trade booking endpoints and the updated Command Center backend
   and dashboard. Use the same Firebase Blue project in Trade and Command Center.
2. Configure the backend's existing `FIREBASE_BLUE_*` Admin credentials,
   `FIREBASE_BLUE_WEB_API_KEY`, and `BLUE_API_BASE_URL` (origin only; locally
   `http://localhost:3001`). Never use a Black Firebase key here.
3. Create a Blue DID mapping with the Trade business document ID in `owner_id`,
   a Blue queue, and no Black branch.
4. In Command Center, open **Agents → AI Receptionist Accounts**, select
   **BMS Trade**, choose the mapped number, and create the account.
5. Keep the existing voice bridge authentication. MCP derives the AI identity
   and business from the DID. There is no customer password or static Firebase
   ID token to enter in the voice bridge env.
6. Enable the existing MCP flags (`AI_FEATURE_ENABLED`, `AI_MCP_ENABLED`,
   `AI_MCP_TRADE_ENABLED`, with `AI_VOICE_PROVIDER=yeastar`). Test availability
   before enabling `AI_MCP_TRADE_REQUESTS_ENABLED=true` for writes.

Run the existing read-only readiness check from the backend folder:

```powershell
npm run check:trade -- YOUR_DID_DIGITS
```

It verifies the business, services and authenticated availability without
creating an inspection or sending customer notifications. A missing Trade AI
account fails the availability step rather than using the guest endpoint.

The super-admin API also supports `GET /api/super-admin/ai-agents?brand=trade`
and `POST /api/super-admin/ai-agents` with `{ "brand": "trade", "did": "...",
"name": "AI Receptionist" }`. Both require a real super-admin session;
setup-secret authentication cannot create identities.

## Authorization

The AI identity is a password-free Firebase Blue user with role
`ai_receptionist`, `aiFrontOffice=true`, and `brand=trade`. Its
`call_center_agents/{uid}` record binds it to exactly one business and DID.
This role does not grant access to Trade's general call-center/chat APIs.
The backend rechecks the mapping, Firebase user, claims, and agent record before
using cached tokens and refreshes them before expiry. Trade independently
verifies each token with revocation checking and checks the live assignment,
agent activity, and business status before reading or writing bookings.

Human agents use their existing stored Firebase Blue login token. Their Blue
agent record must explicitly assign the business through `workshopOwnerUid`
or `assignedBusinessIds`. A verified super admin can access any active business;
an AI account can never use that override.

## Routes

| Command Center (Supabase login) | Trade (Firebase Blue agent token) |
| --- | --- |
| `GET /api/bms-blue/bookings/availability?businessId=&from=&to=` | `GET /api/call-center/bookings/availability?businessId=&from=&to=` |
| `POST /api/bms-blue/bookings` | `POST /api/call-center/bookings` |

POST uses `businessId`, `requestType=existing_service`, `serviceId`, customer,
address, and preferred slots. The agent UID is recorded as the audit actor;
it is never saved as the customer's account UID. Service ownership and slot
availability are checked by Trade. Caller-supplied status, staff assignment,
slug, or customer UID cannot choose the target business or authorize a booking.

Missing/invalid tokens return 401; wrong role, suspended accounts/businesses,
or a different business assignment return 403. Read/write requests do not fall
back to the public booking API if authentication fails.

AI confirmation additionally requires `AI_AUTO_ASSIGN_STAFF_ENABLED=true` in
both the backend and Trade, the business's `sophieBookingAuthority`, and successful staff assignment.
Otherwise submissions remain for review. Only report confirmed when the API
returns `confirmed=true` and `status=scheduled`. For unknown submission outcomes,
reuse the same MCP request key and ask staff to check the request before retrying.

The public `/api/booking/inspection-request` continues serving guest customers;
it rejects the old AI-signature mode. AI booking authorization now uses scoped
Firebase tokens, not `AI_STAFF_ASSIGNMENT_SECRET`.
