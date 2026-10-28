import assert from "node:assert/strict";
import test from "node:test";
import { staffAssignmentResult } from "../src/services/ai/staff-assignment-result.js";

test("Sophie receives assignment status without private staff or leave information", () => {
  const result = staffAssignmentResult({ status: "assigned", staffIds: ["private-id"], leaveReason: "private", proposedSlot: { date: "2099-01-01" } });
  assert.equal(result?.status, "assigned");
  assert.equal(result?.confirmed, false);
  assert.match(result!.message, /Do not say the appointment is confirmed/);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.deepEqual(Object.keys(result!).sort(), ["confirmed", "message", "status"]);
});
test("unassigned bookings remain saved for human review and unknown statuses are ignored", () => {
  assert.match(staffAssignmentResult({ status: "needs_review" })!.message, /booking is saved/);
  assert.equal(staffAssignmentResult({ status: "confirmed" }), undefined);
  assert.equal(staffAssignmentResult(null), undefined);
});
