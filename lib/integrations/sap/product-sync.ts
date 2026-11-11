import "server-only";
import { planProductImport, executeProductImport } from "@/lib/product-import";
import { runIntegrationSyncJob, type SyncJobRecord } from "@/lib/integrations/sap/sync-job";
import { getSapAdapter } from "@/lib/integrations/sap/get-adapter";

/**
 * Milestone 9 (SAP Business One Integration). Product master-data
 * inbound sync -- spec section 8. Deliberately thin: `adapter.
 * fetchProducts()` already returns exactly `SapProductRow[]`, the same
 * shape `planProductImport`/`executeProductImport` (Milestone 1,
 * lib/product-import.ts) already consume from a parsed CSV upload, so
 * this file does no parsing, matching, or upsert logic of its own --
 * see lib/integrations/sap/types.ts's module comment for why that reuse
 * is structural, not a convention someone could accidentally drift away
 * from.
 *
 * Runnable both from an ADMINISTRATOR's "Sync now" click (trigger:
 * "MANUAL") and from scripts/sap-sync.ts under an external scheduler
 * (trigger: "SCHEDULED", triggeredById: null) -- unlike invoice/credit-
 * note sync, this one has no uploadedById requirement to work around,
 * since executeProductImport never asks for one.
 */
export async function runProductSync(trigger: "MANUAL" | "SCHEDULED", triggeredById: string | null): Promise<SyncJobRecord> {
  return runIntegrationSyncJob("PRODUCT_IMPORT", trigger, triggeredById, async () => {
    const adapter = await getSapAdapter();
    const products = await adapter.fetchProducts();

    const plan = await planProductImport(products);
    const result = await executeProductImport(plan, `SAP sync (${trigger.toLowerCase()})`);

    return {
      status: "COMPLETED",
      summary: {
        fetchedCount: products.length,
        createdCount: result.created,
        updatedCount: result.updated,
        unchangedCount: result.unchanged,
        auditEventId: result.auditEventId,
      },
    };
  });
}
