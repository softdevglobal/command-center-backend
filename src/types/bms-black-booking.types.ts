/** Firestore root `bookings/{id}` on bmspro-black (Firebase Black). All document fields pass through untouched. */
export type BlackBookingRecord = {
  id: string;
} & Record<string, unknown>;

export type BlackBookingsByPhoneOptions = {
  /** Raw caller number from the PBX, e.g. "+94766524216", "0766524216", "766524216". */
  phone: string;
  /** Workshop owner UID (Firebase tenant). Filters merged docs in memory — no composite index needed. */
  ownerUid?: string;
};
