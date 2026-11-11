import "server-only";
import { prisma } from "@/lib/prisma";
import type { CreditNoteColumnMapping } from "@/lib/returns-credits/csv";
import type { CreditNoteImportPlan } from "@/lib/returns-credits/plan-import";
import { runAutoMatchForCreditNote } from "@/lib/returns-credits/match-credit-note";

/**
 * Milestone 6B (Returns & Credit Notes). Transactional write of a
 * previously-planned credit note import (lib/returns-credits/plan-
 * import.ts), then automatic matching of every newly-created credit note
 * against its candidate claims -- mirrors lib/invoice-reconciliation/
 * execute-import.ts's own executeSapInvoiceImport exactly: same raised
 * transaction timeout for the same reason (one file can hold hundreds of
 * credit notes, each written then matched sequentially), same two-pass
 * shape (create everything first, then match), same sequential -- never
 * Promise.all'd -- processing, because matching reads back a live SUM of
 * CreditNote.amount per claim that must see every row already written
 * earlier in this same batch.
 */

const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

const SAP_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const SAP_DATE_COMPACT = /^\d{8}$/;

/** Only accepts an unambiguous date format (ISO YYYY-MM-DD, or SAP's
 * common compact YYYYMMDD) -- never a slash-separated date, same
 * reasoning (and same implementation) as lib/invoice-reconciliation/
 * execute-import.ts's own parseSapDate. The raw string is preserved in
 * rawSourceData regardless of whether it parses. */
function parseSapDate(raw: string | null): Date | null {
  if (!raw) return null;
  if (SAP_DATE_ISO.test(raw)) {
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (SAP_DATE_COMPACT.test(raw)) {
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export interface CreditNoteImportResult {
  importBatchId: string;
  importedCreditNoteCount: number;
  duplicateRowCount: number;
  invalidRowCount: number;
  autoMatchedCount: number;
  unresolvedBaseInvoiceReferences: string[];
}

export async function executeCreditNoteImport(
  plan: CreditNoteImportPlan,
  columnMapping: CreditNoteColumnMapping,
  fileName: string,
  uploadedById: string
): Promise<CreditNoteImportResult> {
  const totalRawRows =
    plan.newCreditNotes.reduce((sum, cn) => sum + cn.group.rows.length, 0) +
    plan.duplicateCreditNotes.reduce((sum, dup) => sum + dup.group.rows.length, 0);
  const duplicateRowCount = plan.duplicateCreditNotes.reduce((sum, dup) => sum + dup.group.rows.length, 0);

  const result = await prisma.$transaction(
    async (tx) => {
      const batch = await tx.creditNoteImportBatch.create({
        data: {
          originalFileName: fileName,
          uploadedById,
          columnMapping: columnMapping as object,
          totalRows: totalRawRows + plan.invalidRowCount,
          importedCreditNoteCount: plan.newCreditNotes.length,
          duplicateRowCount,
          invalidRowCount: plan.invalidRowCount,
        },
      });

      const createdCreditNoteIds: string[] = [];

      for (const planned of plan.newCreditNotes) {
        const group = planned.group;

        const record = await tx.creditNote.create({
          data: {
            importBatchId: batch.id,
            sapCreditNoteDocEntry: group.docEntry,
            sapCreditNoteDocNum: group.docNum,
            sapInvoiceId: planned.resolvedSapInvoiceId,
            creditNoteDate: parseSapDate(group.creditNoteDate),
            currencyCode: group.currency,
            amount: group.amount!, // applyCreditNoteColumnMapping already rejected any row with no parseable amount
            notes: group.notes,
            rawSourceData: group.firstRowSourceData,
            recordedById: uploadedById,
          },
        });

        createdCreditNoteIds.push(record.id);
      }

      // Second pass, after every credit note's row exists: auto-match
      // each against its candidate claims, writing a result for every
      // credit note the pure matcher resolves confidently. A credit note
      // it can't resolve (no resolved base invoice, or zero/multiple
      // qualifying claims) is left UNMATCHED -- the manual-reconciliation
      // queue behavior, not retried with a looser rule.
      let autoMatchedCount = 0;
      for (const creditNoteId of createdCreditNoteIds) {
        const matchResult = await runAutoMatchForCreditNote(tx, creditNoteId, uploadedById);
        if (matchResult.matched) autoMatchedCount += 1;
      }

      await tx.auditEvent.create({
        data: {
          actorId: uploadedById,
          action: "CREDIT_NOTE_IMPORT",
          entityType: "CreditNoteImportBatch",
          entityId: batch.id,
          afterData: {
            fileName,
            importedCreditNoteCount: plan.newCreditNotes.length,
            duplicateCreditNoteCount: plan.duplicateCreditNotes.length,
            invalidRowCount: plan.invalidRowCount,
            autoMatchedCount,
            unresolvedBaseInvoiceReferences: plan.unresolvedBaseInvoiceReferences,
            duplicateCreditNoteNumbers: plan.duplicateCreditNotes.map((d) => d.group.docNum),
          },
        },
      });

      return {
        importBatchId: batch.id,
        importedCreditNoteCount: plan.newCreditNotes.length,
        duplicateRowCount,
        invalidRowCount: plan.invalidRowCount,
        autoMatchedCount,
        unresolvedBaseInvoiceReferences: plan.unresolvedBaseInvoiceReferences,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );

  return result;
}
