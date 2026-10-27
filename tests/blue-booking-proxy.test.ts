import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import bookingRouter from "../src/routes/bms_blue/booking.routes.js";
import {
  proxyBlueBookingInspectionRequest,
  proxyBlueBookingSlotAvailability,
} from "../src/services/bms_blue/blue-booking.proxy.service.js";

test("Blue booking proxy requires a Blue token and uses only protected Trade endpoints", async () => {
  const previousBase = process.env.TRADE_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  const calls: { url: URL; init?: RequestInit }[] = [];
  process.env.TRADE_API_BASE_URL = "https://trade.example.test";
  globalThis.fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    return Response.json({ ok: true });
  };
  try {
    assert.throws(() => proxyBlueBookingInspectionRequest("", {}), /token is required/);
    await proxyBlueBookingSlotAvailability("agent-token", { businessId: "business-one", from: "2026-11-01", to: "2026-11-02" });
    assert.equal(calls[0]!.url.searchParams.get("businessId"), "business-one");
    assert.equal(calls[0]!.url.pathname, "/api/call-center/bookings/availability");
    assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), "Bearer agent-token");
    assert.equal(calls[0]!.init?.redirect, "error");
    const payload = { businessId: "business", customer: { fullName: "Customer" } };
    await proxyBlueBookingInspectionRequest("agent-token", payload);
    const headers = new Headers(calls[1]!.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer agent-token");
    assert.equal(calls[1]!.url.pathname, "/api/call-center/bookings");
    assert.equal(calls[1]!.init?.body, JSON.stringify(payload));
    assert.equal(calls[1]!.init?.redirect, "error");
    process.env.TRADE_API_BASE_URL = "http://trade.example.test";
    assert.throws(() => proxyBlueBookingInspectionRequest("agent-token", payload), /requires HTTPS/);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.TRADE_API_BASE_URL;
    else process.env.TRADE_API_BASE_URL = previousBase;
  }
});

test("Blue booking routes reject unauthenticated reads and writes before contacting Trade", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/bms-blue", bookingRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/bms-blue`;
  try {
    assert.equal((await fetch(`${base}/bookings/availability?businessId=business&from=2026-11-01&to=2026-11-02`)).status, 401);
    assert.equal((await fetch(`${base}/bookings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: "business" }) })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
