/** Firestore `businesses/{id}` on bmspro-trade (Firebase Blue). */
export type BusinessRecord = {
  id: string;
} & Record<string, unknown>;

export type BusinessListOptions = {
  limit?: number;
  offset?: number;
};

export type BusinessListResult = {
  data: BusinessRecord[];
  total: number;
  limit: number;
  offset: number;
};
