export type SmsContactType = "customer" | "owner";

export type SmsContactRow = {
  id: string;
  contact_type: SmsContactType;
  display_name: string;
  phone: string;
  owner_uid: string | null;
  created_by: string | null;
  created_at: string;
};

export type SmsContactInput = {
  contactType: SmsContactType;
  displayName: string;
  phone: string;
  ownerUid?: string | null;
  createdBy?: string | null;
};

export type SmsContactUpdateInput = {
  contactType?: SmsContactType;
  displayName?: string;
  phone?: string;
  ownerUid?: string | null;
};

export type SmsContactListFilters = {
  contactType?: SmsContactType;
  phone?: string;
  ownerUid?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type SmsContactListResult = {
  data: SmsContactRow[];
  count: number;
  limit: number;
  offset: number;
};
