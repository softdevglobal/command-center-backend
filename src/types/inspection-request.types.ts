/** Firestore `inspection_requests/{id}` on bmspro-trade (Firebase Blue). */
export type InspectionRequestRecord = {
  id: string;
} & Record<string, unknown>;

export type InspectionRequestListOptions = {
  limit?: number;
  offset?: number;
};

export type InspectionRequestCreateInput = Record<string, unknown>;

export type InspectionRequestListResult = {
  data: InspectionRequestRecord[];
  total: number;
  limit: number;
  offset: number;
};
