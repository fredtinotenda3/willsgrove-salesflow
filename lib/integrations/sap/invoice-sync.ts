import "server-only";
import { planSapInvoiceImport } from "@/lib/invoice-reconciliation/plan-import";
import { executeSapInvoiceImport } from "@/lib/invoice-reconciliation/execute-import";
import { HEADER_TARGET_FIELDS, LINE_TARGET_FIELDS, type InvoiceColumnMapping } from "@/lib/invoice-reconciliation/csv";
import { runIntegrationSyncJob, type SyncJobRecord } from "@/lib/integrations/sap/sync-job";
import { getSapAdapter } from "@/lib/integrations/sap/get-adapter";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 9 (SAP Business One Integration). Invoice inbound sync --
 * spec section 11. `adapter.fetchInvoices()` returns exactly
 * `GroupedInvoiceHeader[]`, the same post-grouping shape
 * `planSapInvoiceImport`/`executeSapInvoiceImport` (Milestone 5,
 * lib/invoice-reconciliation/{plan-import,execute-import}.ts) already
 * consume after parsing and grouping a CSV upload -- the CSV-specific
 * parse/group step (lib/invoice-reconciliation/csv.ts's
 * applyColumnMapping/groupIntoInvoices) is simply skipped, since the
 * adapter already hands back grouped documents. No independent
 * matching/reconciliation logic here -- this project's existing invoice-
 * claim matching (Milestone 5/5B) runs unchanged against whatever
 * SapInvoice rows this produces, exactly as it does for a CSV-uploaded
 * batch.
 *
 * MANUAL-ONLY, unlike product/customer sync: SapInvoiceImportBatch.
 * uploadedById (prisma/schema.prisma) is a required, non-nullable
 * column -- an intentional Milestone 5 design choice this milestone
 * does not touch (spec section 10.2 forbids modifying existing core
 * modules). A scheduled run has no signed-in user to attribute an
 * import batch to, so scripts/sap-sync.ts never calls this function;
 * only an ADMINISTRATOR's explicit "Sync invoices now" dashboard action
 * does, which always has a real triggeredById to pass through as the
 * batch's uploadedById. This is a deliberate, documented scope boundary
 * (see docs/milestones/PROGRESS.md's Milestone 9 section and
 * MILESTONE-9-DELIVERY-REPORT.md), not an oversight.
 */

/**
 * There is no CSV column-mapping step for adapter-sourced data -- every
 * field already arrived as a named property on GroupedInvoiceHeader, not
 * from an arbitrary CSV header a human mapped. This identity mapping
 * (each target field "mapped from" its own name) is stored on
 * SapInvoiceImportBatch.columnMapping purely so that column is never
 * null/fabricated-looking; the UI should render it as "(synced directly
 * from SAP Service Layer -- no column mapping applies)" rather than a
 * real operator-confirmed mapping. See lib/integrations/sap/display.ts.
 */
export const SAP_ADAPTER_INVOICE_COLUMN_MAPPING: InvoiceColumnMapping = Object.fromEntries(
  [...HEADER_TARGET_FIELDS, ...LINE_TARGET_FIELDS].map((field) => [field, field])
) as InvoiceColumnMapping;

export async function runInvoiceSync(triggeredById: string, since?: Date): Promise<SyncJobRecord> {
  return runIntegrationSyncJob("INVOICE_IMPORT", "MANUAL", triggeredById, async () => {
    const adapter = await getSapAdapter();
    const groups = await adapter.fetchInvoices(since);

    const plan = await planSapInvoiceImport(groups, 0);
    const result = await executeSapInvoiceImport(
      plan,
      SAP_ADAPTER_INVOICE_COLUMN_MAPPING,
      `SAP sync (manual)`,
      triggeredById
    );

    const summary = {
      fetchedDocumentCount: groups.length,
      importedInvoiceCount: result.importedInvoiceCount,
      importedLineCount: result.importedLineCount,
      duplicateRowCount: result.duplicateRowCount,
      autoMatchedLineCount: result.autoMatchedLineCount,
      overInvoicingFlaggedCount: result.overInvoicingFlaggedCount,
      unmatchedCustomerCodes: result.unmatchedCustomerCodes,
      importBatchId: result.importBatchId,
    };

    return plan.duplicateInvoices.length > 0 && plan.newInvoices.length === 0
      ? { status: "PARTIAL", summary, errorMessage: "Every fetched invoice was already imported -- nothing new to add." }
      : { status: "COMPLETED", summary };
  });
}

/** For the dashboard's "last successful invoice sync" display (spec
 * section 7's requirement) -- computed live from the most recent
 * COMPLETED job rather than a separate stored cursor column, per this
 * milestone's "derive, don't store a second truth" convention. */
export async function getLastCompletedInvoiceSyncAt(): Promise<Date | null> {
  const last = await prisma.integrationSyncJob.findFirst({
    where: { jobType: "INVOICE_IMPORT", status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  return last?.completedAt ?? null;
}
