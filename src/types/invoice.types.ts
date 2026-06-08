/** Firestore `invoices/{id}` on bmspro-trade (Firebase Blue). */
export type InvoiceRecord = {
  id: string;
} & Record<string, unknown>;

export type InvoiceListOptions = {
  limit?: number;
  offset?: number;
};

export type InvoiceListResult = {
  data: InvoiceRecord[];
  total: number;
  limit: number;
  offset: number;
};
