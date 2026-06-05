import {
  createInspectionRequestInFirestore,
  getInspectionRequestByIdInFirestore,
  listInspectionRequestsInFirestore,
} from "./firestore/inspection-requests.firestore.service.js";
import type {
  InspectionRequestCreateInput,
  InspectionRequestListOptions,
  InspectionRequestListResult,
  InspectionRequestRecord,
} from "../types/inspection-request.types.js";

export async function listInspectionRequests(
  options: InspectionRequestListOptions = {}
): Promise<InspectionRequestListResult> {
  return listInspectionRequestsInFirestore(options);
}

export async function createInspectionRequest(
  input: InspectionRequestCreateInput
): Promise<InspectionRequestRecord> {
  return createInspectionRequestInFirestore(input);
}

export async function getInspectionRequestById(
  id: string
): Promise<InspectionRequestRecord | null> {
  return getInspectionRequestByIdInFirestore(id);
}
