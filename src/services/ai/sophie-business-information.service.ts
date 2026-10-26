import { randomUUID } from "node:crypto";
import admin from "firebase-admin";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFirebaseBlackApp } from "../../db/firebase/firebase.black.js";
import { getFirebaseBlueApp } from "../../db/firebase/firebase.blue.js";
import { businessNameKey, knowledgeSearchSchema, searchBusinessKnowledge } from "./sophie-business-knowledge.service.js";

type Brand = "black" | "trade";
type ObjectValue = Record<string, unknown>;
type EmailBusiness = { brand: Brand; id: string; name: string; aliases?: string[] };
type BusinessDetails = {
  status: string;
  product?: Brand;
  failureStage?: string;
  [key: string]: unknown;
};
type Dependencies = {
  searchBlackBusinesses: (name: string) => Promise<EmailBusiness[]>;
  searchTradeBusinesses: (name: string) => Promise<EmailBusiness[]>;
  getBlackBusinessDetails: (business: EmailBusiness, branchName: string) => Promise<BusinessDetails>;
  getTradeBusinessDetails: (business: EmailBusiness) => Promise<BusinessDetails>;
};

function blackDatabase() {
  const app = getFirebaseBlackApp();
  if (!app) throw new Error("Firebase Black is not configured.");
  return admin.firestore(app);
}

function tradeDatabase() {
  const app = getFirebaseBlueApp();
  if (!app) throw new Error("Firebase Trade is not configured.");
  return admin.firestore(app);
}

function objectValue(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}

function firstText(value: ObjectValue, ...keys: string[]): string {
  for (const key of keys) if (typeof value[key] === "string" && (value[key] as string).trim()) return (value[key] as string).trim();
  return "";
}

function textValues(value: ObjectValue, ...keys: string[]): string[] {
  return [...new Set(keys.flatMap((key) => {
    const entry = value[key];
    return typeof entry === "string" && entry.trim() ? [entry.trim()] : [];
  }))];
}

function safeFields(value: unknown, keys: string[]): ObjectValue {
  const source = objectValue(value);
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function activeBlackOwner(value: ObjectValue): boolean {
  const status = String(value.accountStatus ?? value.status ?? "").toLowerCase();
  return value.role === "workshop_owner" && status !== "suspended" && status !== "inactive";
}

function activeTradeBusiness(value: ObjectValue): boolean {
  return value.isActive !== false && String(value.status ?? "").toLowerCase() !== "suspended";
}

async function searchBlackBusinesses(name: string): Promise<EmailBusiness[]> {
  const db = blackDatabase();
  const users = db.collection("users");
  // Black profiles have used several business-name fields over time. Search
  // exact values in each field first, then scan the bounded owner directory so
  // case, punctuation, or a registered-name alias does not cause a false miss.
  const nameFields = ["name", "businessName", "workshopName", "salonName", "tradingName", "registeredBusinessName", "legalBusinessName"];
  const exactMatches = await Promise.all(nameFields.map((field) => users.where(field, "==", name).limit(20).get()));
  let docs = exactMatches.flatMap((snapshot) => snapshot.docs);
  if (!docs.length) docs = (await users.where("role", "==", "workshop_owner").limit(1000).get()).docs;
  const unique = new Map(docs.map((doc) => [doc.id, doc]));
  return [...unique.values()].flatMap((doc) => {
    const data = doc.data();
    if (!activeBlackOwner(data)) return [];
    const nameAliases = textValues(data, ...nameFields, "displayName");
    const requestedName = businessNameKey(name);
    if (!nameAliases.some((alias) => businessNameKey(alias).includes(requestedName))) return [];
    const businessName = firstText(data, "businessName", "workshopName", "salonName", "tradingName", "registeredBusinessName", "legalBusinessName", "name", "displayName");
    if (!businessName) return [];
    return [{ brand: "black" as const, id: doc.id, name: businessName, aliases: nameAliases }];
  });
}

async function searchTradeBusinesses(name: string): Promise<EmailBusiness[]> {
  const db = tradeDatabase();
  const businesses = db.collection("businesses");
  const nameFields = ["businessName", "tradingName", "registeredBusinessName", "legalBusinessName", "name"];
  const exactMatches = await Promise.all(nameFields.map((field) => businesses.where(field, "==", name).limit(20).get()));
  let docs = exactMatches.flatMap((snapshot) => snapshot.docs);
  if (!docs.length) docs = (await businesses.limit(1000).get()).docs;
  const unique = new Map(docs.map((doc) => [doc.id, doc]));
  return [...unique.values()].flatMap((doc) => {
    const data = doc.data();
    if (!activeTradeBusiness(data)) return [];
    const nameAliases = textValues(data, ...nameFields, "displayName");
    const requestedName = businessNameKey(name);
    if (!nameAliases.some((alias) => businessNameKey(alias).includes(requestedName))) return [];
    const businessName = firstText(data, "businessName", "tradingName", "registeredBusinessName", "legalBusinessName", "name", "displayName");
    if (!businessName) return [];
    return [{ brand: "trade" as const, id: doc.id, name: businessName, aliases: nameAliases }];
  });
}

function blackBranchSummary(docId: string, data: ObjectValue) {
  return {
    id: docId,
    name: firstText(data, "name") || "Branch",
    address: firstText(data, "address", "locationText"),
    phone: firstText(data, "phone"),
    email: firstText(data, "email"),
    timezone: firstText(data, "timezone") || "Australia/Sydney",
    hours: data.hours ?? null,
    status: firstText(data, "status") || "Active",
  };
}

async function getBlackBusinessDetails(business: EmailBusiness, branchName: string): Promise<BusinessDetails> {
  const db = blackDatabase();
  const [ownerSnap, branchesSnap, servicesSnap] = await Promise.all([
    db.doc(`users/${business.id}`).get(),
    db.collection("branches").where("ownerUid", "==", business.id).get(),
    db.collection("services").where("ownerUid", "==", business.id).get(),
  ]);
  if (!ownerSnap.exists || !activeBlackOwner(ownerSnap.data() ?? {})) {
    return { status: "unavailable", product: "black", failureStage: "business_inactive" };
  }

  const owner = ownerSnap.data() ?? {};
  const allBranches = branchesSnap.docs.map((doc) => blackBranchSummary(doc.id, doc.data()));
  let selectedBranches = allBranches;
  if (branchName.trim()) {
    const key = businessNameKey(branchName);
    const matches = allBranches.filter((branch) => businessNameKey(branch.name).includes(key));
    if (matches.length !== 1) return {
      status: "clarification_required", product: "black", branchCandidates: matches.length ? matches.map((branch) => branch.name) : allBranches.map((branch) => branch.name).slice(0, 10),
    };
    selectedBranches = matches;
  }

  const selectedBranchIds = new Set(selectedBranches.map((branch) => branch.id));
  const services = servicesSnap.docs.flatMap((doc) => {
    const data = doc.data();
    if (data.isActive === false || String(data.status ?? "").toLowerCase() === "inactive") return [];
    const assignedBranches = Array.isArray(data.branches) ? data.branches.filter((id): id is string => typeof id === "string") : [];
    if (branchName.trim() && assignedBranches.length && !assignedBranches.some((id) => selectedBranchIds.has(id))) return [];
    return [{
      ...safeFields(data, ["name", "description", "price", "duration", "vehicleTypes", "vehicleTypePricing", "pricingByVehicleType"]),
      ...(assignedBranches.length ? { branchNames: allBranches.filter((branch) => assignedBranches.includes(branch.id)).map((branch) => branch.name) } : {}),
    }];
  });

  return {
    status: "found", product: "black", source: "black_firebase", businessName: business.name,
    profile: safeFields(owner, ["name", "displayName", "contactPhone", "email", "timezone", "state"]),
    branches: selectedBranches.map(({ id: _id, ...branch }) => branch), services: services.slice(0, 100),
    message: "Data was read directly from BMS Black Firestore. Use only these public business and service details; do not expose internal identifiers, staff, customer records, or account settings.",
  };
}

async function getTradeBusinessDetails(business: EmailBusiness): Promise<BusinessDetails> {
  const db = tradeDatabase();
  const [businessSnap, servicesSnap] = await Promise.all([
    db.doc(`businesses/${business.id}`).get(),
    db.collection("services").where("businessId", "==", business.id).get(),
  ]);
  if (!businessSnap.exists || !activeTradeBusiness(businessSnap.data() ?? {})) {
    return { status: "unavailable", product: "trade", failureStage: "business_inactive" };
  }
  const data = businessSnap.data() ?? {};
  const services = servicesSnap.docs.flatMap((doc) => {
    const service = doc.data();
    if (service.isActive !== true) return [];
    return [safeFields(service, ["name", "description", "businessType", "defaultDurationMin", "duration"])];
  });
  return {
    status: "found", product: "trade", source: "trade_firebase", businessName: business.name,
    profile: safeFields(data, ["businessName", "businessType", "businessAddress", "businessPhone", "businessEmail", "timezone", "state", "postcode", "serviceAreas"]),
    services: services.slice(0, 100),
    message: "Data was read directly from BMS Pro Trade Firestore. Use only these public business and service details; do not expose internal identifiers, staff, customer records, billing, or account settings.",
  };
}

const defaults: Dependencies = { searchBlackBusinesses, searchTradeBusinesses, getBlackBusinessDetails, getTradeBusinessDetails };

export const findEmailBusinessSchema = z.object({
  businessName: z.string().trim().min(3).max(180),
  branchName: z.string().trim().max(180).default(""),
  product: z.enum(["all", "black", "trade"]).default("all"),
});

/** Business references are private to one email MCP session; no phone DID is required. */
export function createEmailBusinessLookup(overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const references = new Map<string, { business: EmailBusiness; branchName: string }>();
  return {
    async findBusiness(raw: unknown) {
      const input = findEmailBusinessSchema.parse(raw);
      const key = businessNameKey(input.businessName);
      const sources = input.product === "all" ? ["black", "trade"] as const : [input.product];
      const results = await Promise.all(sources.map((brand) => brand === "black"
        ? deps.searchBlackBusinesses(input.businessName)
        : deps.searchTradeBusinesses(input.businessName)));
      const matches = results.flat().filter((business) => [business.name, ...(business.aliases ?? [])].some((alias) => businessNameKey(alias) === key));
      const candidates = matches.length ? matches : results.flat().filter((business) => [business.name, ...(business.aliases ?? [])].some((alias) => businessNameKey(alias).includes(key)));
      const unique = [...new Map(candidates.map((business) => [`${business.brand}:${business.id}`, business])).values()];
      if (unique.length !== 1) return {
        status: unique.length ? "clarification_required" : "not_found",
        candidates: unique.slice(0, 10).map(({ name, brand }) => ({ businessName: name, product: brand })),
        message: unique.length ? "Ask the customer which listed business or product they mean." : "No Black or Trade business matched that name. Ask for the registered business name or product; do not guess.",
      };
      const business = unique[0]!;
      const businessRef = randomUUID();
      references.set(businessRef, { business, branchName: input.branchName });
      return { status: "found", businessRef, businessName: business.name, product: business.brand };
    },

    async getBusinessDetails(businessRef: string) {
      const selected = references.get(businessRef);
      if (!selected) return { status: "not_found", message: "First identify the business in this email session." };
      return selected.business.brand === "black"
        ? deps.getBlackBusinessDetails(selected.business, selected.branchName)
        : deps.getTradeBusinessDetails(selected.business);
    },
  };
}

export function registerSophieBusinessInformationTools(server: McpServer) {
  const lookup = createEmailBusinessLookup();
  const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  server.tool("search_business_information",
    "For BMS Pros plans, features and policies, search published information with scope=bms_pros. For a customer's Black or Trade business, use scope=business and the full businessName; this searches the Black and Trade business directories directly in their existing Firebase projects, without a phone DID or voice bridge mapping. It returns current public profile, branches and services plus matching published notes. Set product when known and branchName if specified. Ask for clarification when a name is ambiguous.",
    knowledgeSearchSchema.shape, async (args) => {
      const input = knowledgeSearchSchema.parse(args);
      if (input.scope === "bms_pros") return result(await searchBusinessKnowledge(input));

      let approvedInformation: unknown[] = [];
      let knowledgeStatus: "available" | "unavailable" = "available";
      try {
        const knowledge = await searchBusinessKnowledge(input);
        approvedInformation = knowledge.information;
      } catch {
        knowledgeStatus = "unavailable";
      }

      let business: unknown;
      try {
        const match = await lookup.findBusiness({ businessName: input.businessName, branchName: input.branchName, product: input.product });
        if (match.status === "found" && "businessRef" in match && typeof match.businessRef === "string") {
          business = await lookup.getBusinessDetails(match.businessRef);
        } else {
          business = match;
        }
      } catch {
        business = { status: "unavailable", failureStage: "firebase_directory_or_profile", message: "The Black or Trade business directory could not be read." };
      }
      const businessData = objectValue(business);
      return result({
        status: typeof businessData.status === "string" ? businessData.status : "unavailable",
        business,
        approvedInformation,
        knowledgeStatus,
        message: "Live details come directly from the matching Black or Trade Firebase project. ApprovedInformation contains only published notes. Do not invent missing facts or use details from another business.",
      });
    });
  server.tool("find_business",
    "Identify an individual Black or Trade business by name using its Firebase business directory directly, without phone DID routing. Include product when known; ambiguous results require clarification. Returns a session-scoped reference only for one match.",
    findEmailBusinessSchema.shape, async (args) => result(await lookup.findBusiness(args)));
  server.tool("get_business_details",
    "Read the identified business's current public profile, branches and services directly from the Black or Trade Firebase project. Use only a businessRef returned by find_business in this email session. No phone DID mapping is used; no private account or customer information is returned.",
    { businessRef: z.string().uuid() }, async ({ businessRef }) => result(await lookup.getBusinessDetails(businessRef)));
}
