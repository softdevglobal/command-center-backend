import { z } from "zod";

const shortText = z.string().trim().min(1).max(200);
const phone = z.string().trim().regex(/^\+?[0-9() .-]{6,24}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timezone = shortText.refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
}, "Use a valid IANA timezone.");

/** Drafts can be incomplete. Only approved, explicitly supplied facts are stored. */
export const onboardingConfiguration = z.object({
  setupMode: z.enum(["new_business", "existing_business"]).optional(),
  product: z.enum(["black", "pink", "trade"]).optional(),
  branchName: shortText.optional(),
  capacity: z.number().int().min(1).max(100).optional(),
  bookingLimitPerDay: z.number().int().min(1).max(1000).optional(),
  business: z.object({
    tradingName: shortText.optional(),
    legalName: shortText.optional(),
    abn: z.string().trim().regex(/^\d{11}$/).optional(),
    gstRegistered: z.boolean().optional(),
    website: z.string().url().max(500).optional(),
    ownerName: shortText.optional(),
    ownerEmail: z.string().trim().email().max(254).optional(),
    ownerPhone: phone.optional(),
    address: z.string().trim().min(1).max(500).optional(),
    timezone: timezone.optional(),
  }).strict().optional(),
  services: z.array(z.object({
    name: shortText,
    durationMinutes: z.number().int().min(1).max(1440),
    priceBasis: z.string().trim().min(1).max(500),
    gstInclusive: z.boolean().optional(),
    vehicleTypePricing: z.record(z.enum(["small_car", "sedan_wagon", "suv", "ute_van_4wd", "performance_large"]), z.object({ price: z.number().min(0).max(1000000), duration: z.number().int().min(1).max(1440) }).strict()).optional(),
  }).strict()).max(100).optional(),
  businessHours: z.array(z.object({
    day: z.number().int().min(0).max(6).describe("0 = Sunday, 6 = Saturday"),
    opens: clock,
    closes: clock,
  }).strict().refine(hours => hours.opens < hours.closes, "Closing time must follow opening time.")).max(7)
    .refine(hours => new Set(hours.map(item => item.day)).size === hours.length, "Each day can appear only once.").optional(),
  staff: z.array(z.object({ name: shortText, skills: z.array(shortText).max(30),
    email: z.string().trim().email().max(254).optional(),
    workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length).optional(),
    serviceNames: z.array(shortText).min(1).max(100).optional(),
  }).strict()).max(100).optional(),
  faqs: z.array(z.object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(2000),
  }).strict()).max(50).optional(),
  receptionistName: shortText.optional(),
  did: phone.optional(),
  escalation: z.object({ name: shortText, phone, afterHoursAction: z.enum(["callback", "transfer"]) }).strict().optional(),
  bookingPolicy: z.literal("staff_approval_required").optional(),
  cancellationPolicy: z.string().trim().min(1).max(2000).optional(),
  terms: z.object({
    version: shortText,
    billingSummary: z.string().trim().min(1).max(2000),
    privacySummary: z.string().trim().min(1).max(2000),
    recording: z.enum(["disabled", "transcript_only", "audio_and_transcript"]),
    retentionDays: z.number().int().min(0).max(3650),
    marketingEnabled: z.literal(false),
  }).strict().optional(),
}).strict();

export const saveOnboardingArguments = z.object({
  draftId: z.string().uuid().describe("A stable UUID for this draft; reuse it on retries."),
  expectedVersion: z.number().int().min(0).describe("0 creates a draft; updates require the version returned by the server."),
  configuration: onboardingConfiguration.describe("Complete replacement of the saved draft, including fields already collected. Never supply passwords or API keys."),
}).strict();

export const onboardingIdArguments = z.object({ draftId: z.string().uuid() }).strict();
export const onboardingVersionArguments = onboardingIdArguments.extend({ expectedVersion: z.number().int().positive() }).strict();
export const ownerApprovalArguments = onboardingVersionArguments.extend({ accepted: z.literal(true) }).strict();

export type OnboardingConfiguration = z.infer<typeof onboardingConfiguration>;
export type SaveOnboardingArguments = z.infer<typeof saveOnboardingArguments>;
export type OnboardingVersionArguments = z.infer<typeof onboardingVersionArguments>;
export type OwnerApprovalArguments = z.infer<typeof ownerApprovalArguments>;

export function missingOnboardingInformation(config: OnboardingConfiguration): string[] {
  const missing: string[] = [];
  if (!config.setupMode) missing.push("setupMode");
  for (const field of ["product", "receptionistName", "did", "escalation", "bookingPolicy", "cancellationPolicy", "terms"] as const) {
    if (!config[field]) missing.push(field);
  }
  for (const field of ["tradingName", "ownerName", "ownerEmail", "ownerPhone", "address", "timezone"] as const) {
    if (!config.business?.[field]) missing.push(`business.${field}`);
  }
  if (!config.services?.length) missing.push("services");
  if (!config.businessHours?.length) missing.push("businessHours");
  if (!config.staff?.length) missing.push("staff");
  if (config.product && config.product !== "black") missing.push("supported_product_adapter:black_only");
  if (config.setupMode === "new_business") {
    if (config.business?.gstRegistered === undefined) missing.push("business.gstRegistered");
    for (const field of ["branchName", "capacity", "bookingLimitPerDay"] as const) if (!config[field]) missing.push(field);
    const serviceNames = new Set(config.services?.map(service => service.name));
    if (serviceNames.size !== config.services?.length) missing.push("services.unique_names");
    config.services?.forEach((service, index) => {
      if (!Object.keys(service.vehicleTypePricing ?? {}).length) missing.push(`services.${index}.vehicleTypePricing`);
      if (service.gstInclusive === undefined) missing.push(`services.${index}.gstInclusive`);
    });
    const emails = new Set<string>();
    config.staff?.forEach((member, index) => {
      if (!member.skills.length) missing.push(`staff.${index}.skills`);
      const email = member.email?.toLowerCase();
      if (!email || emails.has(email) || email === config.business?.ownerEmail?.toLowerCase()) missing.push(`staff.${index}.unique_email`);
      if (email) emails.add(email);
      if (!member.workingDays?.length || member.workingDays.some(day => !config.businessHours?.some(hours => hours.day === day))) missing.push(`staff.${index}.workingDays`);
      if (!member.serviceNames?.length || member.serviceNames.some(name => !serviceNames.has(name))) missing.push(`staff.${index}.serviceNames`);
    });
    config.services?.forEach((service, index) => {
      if (!config.staff?.some(member => member.serviceNames?.includes(service.name))) missing.push(`services.${index}.assigned_staff`);
    });
  }
  return missing;
}
