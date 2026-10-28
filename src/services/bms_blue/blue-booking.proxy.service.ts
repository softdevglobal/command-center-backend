import { blueEndpoint } from "../../config/blue-api.js";

/**
 * Protected Trade booking endpoints. Both Command Center agents and the MCP
 * provide a Firebase Blue agent token; Trade checks the business assignment.
 */

function bookingEndpoint(path: string): URL {
  // Uses BLUE_API_BASE_URL (the BMS Trade API), same as the call-center routes.
  const url = new URL(blueEndpoint(path));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Trade booking API requires HTTPS.");
  }
  return url;
}

/** GET /api/call-center/bookings/availability?businessId=&from=&to= */
export function proxyBlueBookingSlotAvailability(firebaseIdToken: string, query: {
  businessId: string;
  from: string;
  to: string;
}): Promise<Response> {
  if (!firebaseIdToken.trim()) throw new Error("A Firebase Blue agent token is required.");
  const url = bookingEndpoint("/api/call-center/bookings/availability");
  url.search = new URLSearchParams(query).toString();
  return fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${firebaseIdToken.replace(/^Bearer\s+/i, "").trim()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
  });
}

/** POST /api/call-center/bookings */
export function proxyBlueBookingInspectionRequest(
  firebaseIdToken: string,
  body: unknown,
): Promise<Response> {
  if (!firebaseIdToken.trim()) throw new Error("A Firebase Blue agent token is required.");
  return fetch(bookingEndpoint("/api/call-center/bookings"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${firebaseIdToken.replace(/^Bearer\s+/i, "").trim()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
  });
}
