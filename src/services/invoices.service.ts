import {
  getInvoiceByIdInFirestore,
  listInvoicesInFirestore,
} from "./firestore/invoices.firestore.service.js";
import type {
  InvoiceListOptions,
  InvoiceListResult,
  InvoiceRecord,
} from "../types/invoice.types.js";

export async function listInvoices(
  options: InvoiceListOptions = {}
): Promise<InvoiceListResult> {
  return listInvoicesInFirestore(options);
}

export async function getInvoiceById(
  id: string
): Promise<InvoiceRecord | null> {
  return getInvoiceByIdInFirestore(id);
}
