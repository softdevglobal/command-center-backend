import {
  getInspectionRequestByIdInFirestore,
  listInspectionRequestsInFirestore,
} from "./firestore/inspection-requests.firestore.service.js";
import type {
  InspectionRequestListOptions,
  InspectionRequestListResult,
  InspectionRequestRecord,
} from "../types/inspection-request.types.js";

export async function listInspectionRequests(
  options: InspectionRequestListOptions = {}
): Promise<InspectionRequestListResult> {
  return listInspectionRequestsInFirestore(options);
}

export async function getInspectionRequestById(
  id: string
): Promise<InspectionRequestRecord | null> {
  return getInspectionRequestByIdInFirestore(id);
}
