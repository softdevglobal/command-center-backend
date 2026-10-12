import { proxyBlackCallCenterBranchById } from "../bms_black/black-call-center-branches.proxy.service.js";
import { proxyBlackCallCenterServicesByBranch } from "../bms_black/black-call-center-services.proxy.service.js";
import type {
  FrontOfficeBrandAdapter,
  FrontOfficeTenantContext,
} from "./brand-adapter.js";
import { getBlackAgentIdToken } from "./black-agent-identity.service.js";

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} request failed with HTTP ${response.status}.`);
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(`${label} returned an invalid response.`);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeService(value: unknown): Record<string, unknown> | null {
  const row = record(value);
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;

  const result: Record<string, unknown> = {
    id: row.id,
    name: row.name,
  };
  for (const key of ["description", "price", "duration", "vehicleTypePricing", "pricingByVehicleType"]) {
    const candidate = row[key];
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      (candidate && typeof candidate === "object" && !Array.isArray(candidate))
    ) {
      if (candidate !== undefined) result[key] = candidate;
    }
  }
  return result;
}

export const blackFrontOfficeAdapter: FrontOfficeBrandAdapter = {
  brand: "black",

  async getBranch(context: FrontOfficeTenantContext): Promise<unknown> {
    const token = await getBlackAgentIdToken(context.did, context.ownerId);
    const body = record(await readJsonResponse(
      await proxyBlackCallCenterBranchById(token, context.ownerId, context.branchId),
      "BMS Black branch lookup",
    ));
    const branch = record(body.branch ?? body);
    // Keep this a business-hours/profile response; never return raw Firestore fields.
    return {
      id: context.branchId,
      name: typeof branch.name === "string" ? branch.name : context.branchName,
      address: typeof branch.address === "string" ? branch.address : undefined,
      phone: typeof branch.phone === "string" ? branch.phone : undefined,
      timeZone: typeof branch.timeZone === "string" ? branch.timeZone : undefined,
      daySchedule: branch.daySchedule,
      openingHours: branch.openingHours,
    };
  },

  async listServices(context: FrontOfficeTenantContext): Promise<unknown[]> {
    const token = await getBlackAgentIdToken(context.did, context.ownerId);
    const body = record(await readJsonResponse(
      await proxyBlackCallCenterServicesByBranch(
        token,
        context.ownerId,
        context.branchId,
      ),
      "BMS Black service lookup",
    ));
    return Array.isArray(body.services)
      ? body.services.map(safeService).filter((service): service is Record<string, unknown> => service !== null)
      : [];
  },
};
