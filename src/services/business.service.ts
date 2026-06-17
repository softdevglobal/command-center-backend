import {
  getBusinessByIdInFirestore,
  listBusinessesInFirestore,
} from "./firestore/business.firestore.service.js";
import type {
  BusinessListOptions,
  BusinessListResult,
  BusinessRecord,
} from "../types/business.types.js";

export async function listBusinesses(
  options: BusinessListOptions = {}
): Promise<BusinessListResult> {
  return listBusinessesInFirestore(options);
}

export async function getBusinessById(
  id: string
): Promise<BusinessRecord | null> {
  return getBusinessByIdInFirestore(id);
}
