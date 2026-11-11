import "server-only";
import { planCreditNoteImport } from "@/lib/returns-credits/plan-import";
import { executeCreditNoteImport } from "@/lib/returns-credits/execute-import";
import { CREDIT_NOTE_TARGET_FIELDS, type CreditNoteColumnMapping } from "@/lib/returns-credits/csv";
import { runIntegrationSyncJob, type SyncJobRecord } from "@/lib/integrations/sap/sync-job";
import { getSapAdapter } from "@/lib/integrations/sap/get-adapter";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 9 (SAP Business One Integration). Credit-note inbound sync
 * -- spec section 12. Symmetric to lib/integrations/sap/invoice-sync.ts
 * in every respect, including MANUAL-ONLY (CreditNoteImportBatch.
 * uploadedById is likewise required/non-nullable, a Milestone 6B design
 * choice this milestone does not touch).
 */
export const SAP_ADAPTER_CREDIT_NOTE_COLUMN_MAPPING: CreditNoteColumnMapping = Object.fromEntries(
  CREDIT_NOTE_TARGET_FIELDS.map((field) => [field, field])
) as CreditNoteColumnMapping;

export async function runCreditNoteSync(triggeredById: string, since?: Date): Promise<SyncJobRecord> {
  return runIntegrationSyncJob("CREDIT_NOTE_IMPORT", "MANUAL", triggeredById, async () => {
    const adapter = await getSapAdapter();
    const groups = await adapter.fetchCreditNotes(since);

    const plan = await planCreditNoteImport(groups, 0);
    const result = await executeCreditNoteImport(
      plan,
      SAP_ADAPTER_CREDIT_NOTE_COLUMN_MAPPING,
      `SAP sync (manual)`,
      triggeredById
    );

    const summary = {
      fetchedDocumentCount: groups.length,
      importedCreditNoteCount: result.importedCreditNoteCount,
      duplicateRowCount: result.duplicateRowCount,
      autoMatchedCount: result.autoMatchedCount,
      unresolvedBaseInvoiceReferences: result.unresolvedBaseInvoiceReferences,
      importBatchId: result.importBatchId,
    };

    return plan.duplicateCreditNotes.length > 0 && plan.newCreditNotes.length === 0
      ? { status: "PARTIAL", summary, errorMessage: "Every fetched credit note was already imported -- nothing new to add." }
      : { status: "COMPLETED", summary };
  });
}

export async function getLastCompletedCreditNoteSyncAt(): Promise<Date | null> {
  const last = await prisma.integrationSyncJob.findFirst({
    where: { jobType: "CREDIT_NOTE_IMPORT", status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  return last?.completedAt ?? null;
}
