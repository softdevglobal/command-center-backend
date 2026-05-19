import { blackCallCenterFetch } from "./black-call-center.proxy.util.js";

const BLACK_BOOKINGS_PATH = "/api/call-center/bookings";

function bookingByIdPath(bookingId: string): string {
  return `${BLACK_BOOKINGS_PATH}/${encodeURIComponent(bookingId.trim())}`;
}

function jsonWriteInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** `GET /api/call-center/bookings` — global list (no X-Tenant-Id on Black). */
export async function proxyBlackCallCenterBookings(
  firebaseIdToken: string
): Promise<Response> {
  return blackCallCenterFetch(BLACK_BOOKINGS_PATH, firebaseIdToken, {
    method: "GET",
  });
}

/** `GET /api/call-center/bookings/availability` */
export async function proxyBlackCallCenterBookingAvailability(
  firebaseIdToken: string,
  tenantId: string,
  query: { branchId: string; date: string; serviceIds: string }
): Promise<Response> {
  const path = `${BLACK_BOOKINGS_PATH}/availability?branchId=${encodeURIComponent(query.branchId)}&date=${encodeURIComponent(query.date)}&serviceIds=${encodeURIComponent(query.serviceIds)}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `POST /api/call-center/bookings` */
export async function proxyBlackCallCenterCreateBooking(
  firebaseIdToken: string,
  tenantId: string,
  body: unknown
): Promise<Response> {
  return blackCallCenterFetch(BLACK_BOOKINGS_PATH, firebaseIdToken, {
    ...jsonWriteInit("POST", body),
    tenantId,
  });
}

/** `GET /api/call-center/bookings/:bookingId` */
export async function proxyBlackCallCenterBookingById(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string
): Promise<Response> {
  return blackCallCenterFetch(bookingByIdPath(bookingId), firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `PATCH /api/call-center/bookings/:bookingId` — workflow status (Confirmed / Canceled). */
export async function proxyBlackCallCenterPatchBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  return blackCallCenterFetch(bookingByIdPath(bookingId), firebaseIdToken, {
    ...jsonWriteInit("PATCH", body),
    tenantId,
  });
}

/** `POST /api/call-center/bookings/:bookingId/confirm` */
export async function proxyBlackCallCenterConfirmBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  const path = `${bookingByIdPath(bookingId)}/confirm`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    ...jsonWriteInit("POST", body),
    tenantId,
  });
}

/** `PATCH /api/call-center/bookings/:bookingId/reschedule` */
export async function proxyBlackCallCenterRescheduleBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  const path = `${bookingByIdPath(bookingId)}/reschedule`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    ...jsonWriteInit("PATCH", body),
    tenantId,
  });
}

/** `POST /api/call-center/bookings/:bookingId/cancel` */
export async function proxyBlackCallCenterCancelBooking(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  body: unknown
): Promise<Response> {
  const path = `${bookingByIdPath(bookingId)}/cancel`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    ...jsonWriteInit("POST", body),
    tenantId,
  });
}

/** `GET /api/call-center/bookings/:bookingId/additional-issues` */
export async function proxyBlackCallCenterBookingAdditionalIssues(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string
): Promise<Response> {
  const path = `${bookingByIdPath(bookingId)}/additional-issues`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    method: "GET",
    tenantId,
  });
}

/** `PATCH /api/call-center/bookings/:bookingId/additional-issues/:issueId` */
export async function proxyBlackCallCenterPatchBookingIssue(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  issueId: string,
  body: unknown
): Promise<Response> {
  const path = `${bookingByIdPath(bookingId)}/additional-issues/${encodeURIComponent(issueId.trim())}`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    ...jsonWriteInit("PATCH", body),
    tenantId,
  });
}

/** `PATCH /api/call-center/bookings/:bookingId/additional-issues/:issueId/price` */
export async function proxyBlackCallCenterPatchBookingIssuePrice(
  firebaseIdToken: string,
  tenantId: string,
  bookingId: string,
  issueId: string,
  body: unknown
): Promise<Response> {
  const path = `${bookingByIdPath(bookingId)}/additional-issues/${encodeURIComponent(issueId.trim())}/price`;
  return blackCallCenterFetch(path, firebaseIdToken, {
    ...jsonWriteInit("PATCH", body),
    tenantId,
  });
}
