/** Only expose allocation outcomes; never send leave reasons or private staff records to the model. */
export type StaffAssignmentResult = { status: "assigned" | "needs_review"; confirmed: boolean; message: string };
export function staffAssignmentResult(value: unknown, bookingConfirmed = false): StaffAssignmentResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = (value as Record<string, unknown>).status;
  if (status !== "assigned" && status !== "needs_review") return undefined;
  return { status, confirmed: bookingConfirmed, message: status === "assigned"
    ? bookingConfirmed
      ? "Staff have been allocated and the business has confirmed the booking. You may tell the customer it is confirmed."
      : "Staff have been allocated, but the booking is still awaiting business or staff approval. Do not say the appointment is confirmed."
    : "The booking is saved but staff assignment needs human review. Do not promise a staff member or work time." };
}
