import "server-only";
import { planCustomerMasterImport, executeCustomerMasterImport } from "@/lib/customer-master-import";
import { runIntegrationSyncJob, type SyncJobRecord } from "@/lib/integrations/sap/sync-job";
import { getSapAdapter } from "@/lib/integrations/sap/get-adapter";

/**
 * Milestone 9 (SAP Business One Integration). Customer master-data
 * inbound sync -- spec section 9. Symmetric to lib/integrations/sap/
 * product-sync.ts: `adapter.fetchCustomers()` returns exactly
 * `CustomerMasterRow[]`, the same shape `planCustomerMasterImport`/
 * `executeCustomerMasterImport` (Milestone 1, lib/customer-master-
 * import.ts) already consume from a parsed CSV upload. No independent
 * upsert/matching logic here.
 */
export async function runCustomerSync(trigger: "MANUAL" | "SCHEDULED", triggeredById: string | null): Promise<SyncJobRecord> {
  return runIntegrationSyncJob("CUSTOMER_IMPORT", trigger, triggeredById, async () => {
    const adapter = await getSapAdapter();
    const customers = await adapter.fetchCustomers();

    const plan = await planCustomerMasterImport(customers);
    const result = await executeCustomerMasterImport(plan, `SAP sync (${trigger.toLowerCase()})`);

    return {
      status: "COMPLETED",
      summary: {
        fetchedCount: customers.length,
        createdCount: result.created,
        updatedCount: result.updated,
        unchangedCount: result.unchanged,
        unmatchedPriceListCodes: plan.unmatchedPriceListCodes,
        auditEventId: result.auditEventId,
      },
    };
  });
}
