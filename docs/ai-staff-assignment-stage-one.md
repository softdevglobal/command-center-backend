# Sophie staff assignment: stage one

Sophie-created requests and customer-portal submissions for Black bookings and Trade inspections can allocate staff during request creation. Owners separately grant Sophie permission to confirm requests. When permission is off, the existing manual approval workflow remains in place. No separate model, MCP server, or voice bridge environment setting is required. Assignment is part of request creation, so the model cannot skip a follow-up tool call.

## Enable

Deploy the Black, Trade, and Command Center changes. Set `AI_AUTO_ASSIGN_STAFF_ENABLED=true` in Black, Trade, and the Command Center backend; it defaults to disabled and is the rollout gate. The owner must also enable **Sophie booking authority** in product settings; that permission defaults off. An eligible assignment is confirmed only after the owner grants authority. If no qualified staff member and time can be allocated, the request stays pending for owner review. Existing booking-write flags still apply (`AI_MCP_BOOKINGS_ENABLED`, `AI_MCP_TRADE_REQUESTS_ENABLED`, plus the existing AI/MCP product flags).

For Trade, create a scoped AI receptionist account in Firebase Blue through Command Center. The backend mints a short-lived booking-only Firebase token and calls Trade's protected call-center booking API. See [Trade booking authentication](trade-booking-auth.md) for setup and deployment order. The old shared `AI_STAFF_ASSIGNMENT_SECRET` signature is no longer used for Sophie bookings; the public customer endpoint rejects that mode. Restart the affected services after configuration.

## Black

- Configure each service's existing `staffIds` allow-list. An empty list requires human review, even though the manual picker may allow a broader roster.
- Staff must be active, belong to the workshop, and work at the mapped branch on that weekday. Weekly schedule off days and configured hours/breaks apply. Without a weekly schedule the primary branch and branch opening hours apply.
- Approved and pending leave exclude the staff member for the day. This stage conservatively blocks partial-day leave for the whole day in Black, matching its existing day-based assignment check.
- A positive snapshotted duration is required for every service. Work is planned sequentially at or after drop-off and within branch hours. Earliest available work time wins, then lower daily workload and stable staff ID.
- Existing non-cancelled, non-completed assignments across the workshop are checked. Unknown durations block conservatively. All selected services must be assignable; otherwise all remain unassigned for the existing admin review.
- The booking and assignment are saved in one Firestore transaction. Each service records `staffId`, `staffName`, `plannedStartTime`, `plannedEndTime`, assignment source (`sophie` or `customer_portal`), and accepted approval status when Sophie is authorized. With permission and a successful plan, the booking becomes `Confirmed`; otherwise it stays pending.
- Existing notifications notify the assigned staff. The dashboard service preview shows the planned work times separately from drop-off. Staff acceptance rechecks the exact assignment and rejects changed availability with HTTP 409.
- Idempotent retries return the original booking and allocation. Earlier saved bookings are not reassigned by retrying them.

## Trade

- Customer-portal inspection requests and Sophie-created requests use the same assignment checks when the feature flag is enabled. Sophie submits through a protected endpoint that checks its Firebase Blue token and exact business assignment; normal customer-portal requests use the existing guest endpoint.
- This allocates the inspection only; converting it into a job does not automatically reserve the inspector for the job.
- Open Trade **Team → add/edit staff → Role & schedule → Services this staff member can perform** and select their services. This saves an explicit staff `serviceIds` list, scoped and validated against the current business. An explicitly empty list excludes the person from automatic assignment. Older mobile clients that omit this field preserve its existing value.
- A configured service `staffIds` list is authoritative when present. Otherwise an explicit staff `serviceIds` list applies. For older staff records without that list, exact staff `skills` or an exact `staffType` match to service `requiredSkill` can establish eligibility. Free-text roles are not semantically guessed. Missing or inconsistent skill configuration requires human review.
- Only active business staff with configured working days qualify. The owner is not silently used as a fallback.
- Working days, pending/approved full or partial leave, business closures, other jobs, scheduled inspections, and other pending Sophie assignments are checked in the business timezone.
- `businesses/{id}.aiInspectionDurationMin` defaults to 60 minutes. `aiAssignmentTravelBufferMin` defaults to 30 minutes between visits; it is a configurable allowance, not a map-based travel estimate. Staff-specific shifts, licensing checks, and route optimization are outside this stage.
- Customer preferred sessions are tried in their supplied order. Within a session, lower daily workload wins, then earlier available work time and stable staff ID.
- Staff assignment and request creation use one transaction and an Admin SDK-only `aiAssignmentGuards` document. With owner permission and a successful plan, the request is `scheduled`; `assignedTo`, `scheduledSlot`, and the work window are committed together. Without permission, the request remains `pending` and the proposed allocation awaits review. A failed plan always remains pending for human review.
- The request detail shows the proposed allocation and review message. Staff receive the existing mobile push notification. Owner confirmation or time changes recheck the assigned inspector before saving. Proposing different customer sessions clears the earlier allocation so it cannot be carried into a different date without reassignment.

## Scope of the reservation

Without owner permission, these are provisional allocations awaiting existing approval. With permission, only a fully eligible assignment is confirmed. Concurrent AI writes are serialized and check current product records. Existing manual/mobile assignment paths are not converted to a universal exclusive calendar in this stage. Revalidation on the covered approval paths detects intervening changes. An owner can still deliberately override assignments through the existing admin workflow.

The MCP result adds only sanitized `staffAssignment.status` (`assigned` or `needs_review`), a `confirmed` boolean, and wording that matches the saved status. It does not expose private leave details. Unknown booking creation outcomes retain the existing duplicate-prevention handling.

## Verification

Run the new planner/auth tests, the existing AI booking and MCP suites, and TypeScript checks in all three repositories. Before production rollout, make controlled Sophie and customer-portal submissions for each product and verify staff identity, service eligibility, work period, confirmed versus pending outcomes, customer/staff notifications, and unchanged booking identity on retry. Also verify a leave conflict and a no-qualified-staff case. Production phone calls and outbound notification delivery are separate from local automated checks.
