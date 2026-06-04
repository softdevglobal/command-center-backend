import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseClient,
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "../db/supabase/supabase.client.js";
import type {
  SmsContactInput,
  SmsContactListFilters,
  SmsContactListResult,
  SmsContactRow,
  SmsContactType,
  SmsContactUpdateInput,
} from "../types/sms-contact.types.js";
import { SmsServiceError } from "./sms.service.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SMS_CONTACT_TYPES = new Set<SmsContactType>(["customer", "owner"]);

function assertSupabaseForSmsContacts(): {
  supabaseUrl: string;
  serviceRoleKey: string;
} {
  const supabaseUrl = getSupabaseProjectUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = getMissingSupabaseRegistrationEnv();
    throw new SmsServiceError(
      500,
      missing.length > 0
        ? `Missing or unset Supabase env: ${missing.join(", ")}. Ensure project-root .env exists and restart the server.`
        : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for SMS contact APIs)."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

function adminClient(): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } = assertSupabaseForSmsContacts();
  return createSupabaseClient(supabaseUrl, serviceRoleKey);
}

function withSmsContactsSchemaHint(message: string): string {
  return `${message}. Ensure public.sms_contacts exists in Supabase.`;
}

function throwSupabaseError(error: { message: string }): never {
  throw new SmsServiceError(500, withSmsContactsSchemaHint(error.message));
}

function cleanRequired(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SmsServiceError(400, `${label} is required.`);
  }
  return trimmed;
}

function isDuplicateKeyMessage(message: string): boolean {
  return /duplicate key|23505/i.test(message);
}

function normalizePagination(filters: { limit?: number; offset?: number }): {
  limit: number;
  offset: number;
} {
  const limitRaw = filters.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT)
  );
  const offsetRaw = filters.offset ?? 0;
  const offset = Math.max(
    0,
    Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0
  );
  return { limit, offset };
}

function parseContactType(value: unknown, label = "contactType"): SmsContactType {
  if (typeof value !== "string" || !SMS_CONTACT_TYPES.has(value as SmsContactType)) {
    throw new SmsServiceError(
      400,
      `${label} must be one of: customer, owner.`
    );
  }
  return value as SmsContactType;
}

function normalizeCreateInput(body: SmsContactInput): {
  contact_type: SmsContactType;
  display_name: string;
  phone: string;
  owner_uid: string | null;
  created_by: string | null;
} {
  return {
    contact_type: parseContactType(body.contactType),
    display_name: cleanRequired(body.displayName, "displayName"),
    phone: cleanRequired(body.phone, "phone"),
    owner_uid: body.ownerUid?.trim() || null,
    created_by: body.createdBy?.trim() || null,
  };
}

function normalizeUpdateInput(
  body: SmsContactUpdateInput
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (body.contactType !== undefined) {
    patch.contact_type = parseContactType(body.contactType);
  }
  if (body.displayName !== undefined) {
    patch.display_name = cleanRequired(body.displayName, "displayName");
  }
  if (body.phone !== undefined) {
    patch.phone = cleanRequired(body.phone, "phone");
  }
  if (body.ownerUid !== undefined) {
    patch.owner_uid = body.ownerUid?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    throw new SmsServiceError(400, "Provide at least one field to update.");
  }

  return patch;
}

export async function listSmsContacts(
  filters: SmsContactListFilters
): Promise<SmsContactListResult> {
  const { limit, offset } = normalizePagination(filters);
  const supabase = adminClient();

  let q = supabase
    .from("sms_contacts")
    .select("*", { count: "exact" })
    .order("display_name", { ascending: true });

  const contactType = filters.contactType?.trim();
  if (contactType) {
    q = q.eq("contact_type", parseContactType(contactType, "contactType filter"));
  }

  const phone = filters.phone?.trim();
  if (phone) q = q.eq("phone", phone);

  const ownerUid = filters.ownerUid?.trim();
  if (ownerUid) q = q.eq("owner_uid", ownerUid);

  const search = filters.search?.trim();
  if (search) {
    q = q.or(
      `display_name.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throwSupabaseError(error);

  return {
    data: (data ?? []) as SmsContactRow[],
    count: count ?? 0,
    limit,
    offset,
  };
}

export async function getSmsContactById(
  id: string
): Promise<SmsContactRow | null> {
  const contactId = cleanRequired(id, "id");
  const supabase = adminClient();

  const { data, error } = await supabase
    .from("sms_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();

  if (error) throwSupabaseError(error);
  return (data as SmsContactRow | null) ?? null;
}

export async function createSmsContact(
  body: SmsContactInput
): Promise<SmsContactRow> {
  const payload = normalizeCreateInput(body);
  const supabase = adminClient();

  const { data, error } = await supabase
    .from("sms_contacts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isDuplicateKeyMessage(error.message)) {
      throw new SmsServiceError(
        409,
        `An SMS contact with contactType "${payload.contact_type}" and phone "${payload.phone}" already exists.`
      );
    }
    throwSupabaseError(error);
  }

  return data as SmsContactRow;
}

export async function updateSmsContact(
  id: string,
  body: SmsContactUpdateInput
): Promise<SmsContactRow> {
  const contactId = cleanRequired(id, "id");
  const patch = normalizeUpdateInput(body);
  const supabase = adminClient();

  const { data, error } = await supabase
    .from("sms_contacts")
    .update(patch)
    .eq("id", contactId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new SmsServiceError(404, "SMS contact not found.");
    }
    if (isDuplicateKeyMessage(error.message)) {
      throw new SmsServiceError(
        409,
        "An SMS contact with that contactType and phone already exists."
      );
    }
    throwSupabaseError(error);
  }

  return data as SmsContactRow;
}

export async function deleteSmsContact(id: string): Promise<SmsContactRow> {
  const contactId = cleanRequired(id, "id");
  const supabase = adminClient();

  const existing = await getSmsContactById(contactId);
  if (!existing) {
    throw new SmsServiceError(404, "SMS contact not found.");
  }

  const { error } = await supabase
    .from("sms_contacts")
    .delete()
    .eq("id", contactId);

  if (error) throwSupabaseError(error);
  return existing;
}
