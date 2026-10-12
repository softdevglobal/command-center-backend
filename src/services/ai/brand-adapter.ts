/** Trusted tenant context resolved by the server from the Yeastar credential -> DID map. */
export type FrontOfficeTenantContext = {
  did: string;
  tenantId: string;
  ownerId: string;
  branchId: string;
  branchName: string | null;
  workshopName: string | null;
};

export type FrontOfficeBrand = "black";

/**
 * Read-only front-office contract. Brand adapters normalize data from their own
 * source of truth. Booking writes stay out of this interface until that brand's
 * commit path is proven idempotent and conflict-safe.
 */
export interface FrontOfficeBrandAdapter {
  readonly brand: FrontOfficeBrand;
  getBranch(context: FrontOfficeTenantContext): Promise<unknown>;
  listServices(context: FrontOfficeTenantContext): Promise<unknown[]>;
}
