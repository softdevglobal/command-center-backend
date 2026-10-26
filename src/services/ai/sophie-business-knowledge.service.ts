import { z } from "zod";
import { createSupabaseClient, getSupabaseProjectUrl, getSupabaseServiceRoleKey } from "../../db/supabase/supabase.client.js";

export function businessNameKey(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const businessKnowledgeSchema = z.object({
  scope: z.enum(["bms_pros", "business"]),
  product: z.enum(["all", "black", "trade"]),
  businessName: z.string().trim().max(180).default(""),
  title: z.string().trim().min(3).max(200),
  content: z.string().trim().min(3).max(12000),
  published: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.scope === "business" && businessNameKey(value.businessName).length < 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["businessName"], message: "Enter the full business name." });
  }
});

export type BusinessKnowledgeInput = z.infer<typeof businessKnowledgeSchema>;
export const knowledgeSearchSchema = z.object({
  scope: z.enum(["bms_pros", "business"]),
  product: z.enum(["all", "black", "trade"]).default("all"),
  businessName: z.string().trim().max(180).default(""),
  branchName: z.string().trim().max(180).default(""),
  query: z.string().trim().max(300).default(""),
});

function database() {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) throw new Error("Business information storage is not configured.");
  return createSupabaseClient(url, key);
}

const publicColumns = "id,scope,product,business_name,title,content,published,updated_at";

export async function listBusinessKnowledge() {
  const result = await database().from("sophie_business_knowledge").select(publicColumns).order("updated_at", { ascending: false }).limit(500);
  if (result.error) throw new Error("Could not load business information. Run the Sophie business knowledge migration.");
  return result.data ?? [];
}

export async function saveBusinessKnowledge(id: string, input: BusinessKnowledgeInput, actorId: string) {
  const businessName = input.scope === "business" ? input.businessName : "";
  const result = await database().from("sophie_business_knowledge").upsert({
    id, scope: input.scope, product: input.product, business_name: businessName,
    business_key: businessNameKey(businessName), title: input.title, content: input.content,
    published: input.published, updated_by: actorId, updated_at: new Date().toISOString(),
  }, { onConflict: "id" }).select(publicColumns).single();
  if (result.error) throw new Error("Could not save business information.");
  return result.data;
}

export async function searchBusinessKnowledge(raw: unknown) {
  const input = knowledgeSearchSchema.parse(raw);
  if (input.scope === "business" && businessNameKey(input.businessName).length < 3) {
    return { status: "clarification_required", information: [], message: "Ask the customer for the full business name before searching individual business information." };
  }
  let query = database().from("sophie_business_knowledge")
    .select("id,scope,product,business_name,title,content,updated_at")
    .eq("published", true).eq("scope", input.scope);
  if (input.scope === "business") query = query.eq("business_key", businessNameKey(input.businessName));
  if (input.product !== "all") query = query.in("product", ["all", input.product]);
  if (input.query) query = query.textSearch("search_document", input.query, { type: "websearch", config: "english" });
  const result = await query.order("updated_at", { ascending: false }).limit(8);
  if (result.error) throw new Error("Published business information is unavailable. Do not invent facts.");
  return {
    status: result.data?.length ? "found" : "not_found",
    information: result.data ?? [],
    message: "Only these published entries are approved for customer replies. An empty query browses entries in the selected scope; use that if keyword search finds nothing. Never mix facts from different businesses or products.",
  };
}
