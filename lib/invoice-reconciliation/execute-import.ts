import "server-only";
import { prisma } from "@/lib/prisma";
import type { InvoiceColumnMapping } from "@/lib/invoice-reconciliation/csv";
import type { InvoiceImportPlan } from "@/lib/invoice-reconciliation/plan-import";
import { runAutoMatchForInvoice, recomputeInvoiceHeaderStatus } from "@/lib/invoice-reconciliation/match-invoice";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Transactional write of a
 * previously-planned import (lib/invoice-reconciliation/plan-import.ts),
 * then automatic matching of every newly-created invoice's lines --
 * mirroring lib/customer-master-import.ts's executeCustomerMasterImport
 * for the write-and-audit shape, extended because this milestone must
 * also persist a real queryable entity graph (SapInvoiceImportBatch /
 * SapInvoice / SapInvoiceLine) and run matching immediately, not just
 * upsert fields onto existing rows.
 */

// One file can hold hundreds of invoices, each written with its own
// sequential line-create + auto-match pass (see scripts/remove-demo-data.ts
// and executeCustomerMasterImport's own comments on why this project never
// parallelizes writes against one interactive-transaction client) -- so
// the timeout is raised well above the 5000ms Prisma default, the same
// reasoning as every other multi-step transaction in this codebase.
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

const SAP_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const SAP_DATE_COMPACT = /^\d{8}$/;

/** Only accepts an unambiguous date format (ISO YYYY-MM-DD, or SAP's
 * common compact YYYYMMDD) -- never a slash-separated date, since DD/MM
 * vs. MM/DD can't be told apart without knowing the exporting locale, and
 * guessing one would silently misdate invoices (spec section 3: "do not
 * invent missing SAP fields or silently substitute values"). The raw
 * string is preserved in rawSourceData regardless of whether it parses. */
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

function parseLineNumber(raw: string | null, fallbackIndex: number): number {
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallbackIndex + 1;
}

export interface SapInvoiceImportResult {
  importBatchId: string;
  importedInvoiceCount: number;
  importedLineCount: number;
  duplicateRowCount: number;
  invalidRowCount: number;
  autoMatchedLineCount: number;
  overInvoicingFlaggedCount: number;
  unmatchedCustomerCodes: string[];
}

export async function executeSapInvoiceImport(
  plan: InvoiceImportPlan,
  columnMapping: InvoiceColumnMapping,
  fileName: string,
  uploadedById: string
): Promise<SapInvoiceImportResult> {
  const totalLineRows = plan.newInvoices.reduce((sum, inv) => sum + inv.group.lines.length, 0) +
    plan.duplicateInvoices.reduce((sum, dup) => sum + dup.group.lines.length, 0);

  const result = await prisma.$transaction(
    async (tx) => {
      const batch = await tx.sapInvoiceImportBatch.create({
        data: {
          originalFileName: fileName,
          uploadedById,
          columnMapping: columnMapping as object,
          totalRows: totalLineRows + plan.invalidRowCount,
          importedInvoiceCount: plan.newInvoices.length,
          importedLineCount: plan.newInvoices.reduce((sum, inv) => sum + inv.group.lines.length, 0),
          duplicateRowCount: plan.duplicateInvoices.reduce((sum, dup) => sum + dup.group.lines.length, 0),
          invalidRowCount: plan.invalidRowCount,
        },
      });

      const createdInvoiceIds: string[] = [];

      // Sequential (see module comment above): each invoice needs its own
      // rows created before it can be auto-matched, and auto-matching
      // itself reads back the cumulative invoiced quantity of every order
      // line it touches, so interleaving writes with Promise.all would
      // make that read unreliable even if concurrent queries against one
      // transaction client were otherwise safe (they are documented by
      // Prisma as not being so).
      for (const planned of plan.newInvoices) {
        const group = planned.group;

        const invoice = await tx.sapInvoice.create({
          data: {
            importBatchId: batch.id,
            sapDocEntry: group.docEntry,
            sapDocNum: group.docNum,
            customerSapCode: group.customerCode,
            customerName: group.customerName,
            matchedCustomerId: planned.matchedCustomerId,
            invoiceDate: parseSapDate(group.invoiceDate),
            currencyCode: group.currency,
            documentStatusRaw: group.documentStatus,
            isCancelledOrReversed: group.isCancelledOrReversed,
            sapOrderReference: group.orderReference,
            subtotal: group.subtotal,
            taxTotal: group.taxTotal,
            total: group.total,
            rawSourceData: group.firstRowSourceData,
          },
        });

        for (let i = 0; i < group.lines.length; i++) {
          const line = group.lines[i];
          await tx.sapInvoiceLine.create({
            data: {
              sapInvoiceId: invoice.id,
              lineNumber: parseLineNumber(line.lineNumber ?? line.docLineNum, i),
              sapItemCode: line.itemCode,
              sapItemDescription: line.itemDescription,
              quantityInvoiced: line.quantity!, // applyColumnMapping already rejected any row with no parseable quantity
              unitOfMeasure: line.unitOfMeasure,
              unitPrice: line.unitPrice,
              discount: line.discount,
              taxCode: line.taxCode,
              lineTotal: line.lineTotal,
              sapDocLineNum: line.docLineNum,
              rawSourceData: line.rawSourceData,
            },
          });
        }

        createdInvoiceIds.push(invoice.id);
      }

      // Second pass, after every invoice's rows exist: auto-match each
      // invoice's lines, then recompute its header status. Kept as a
      // separate pass (not folded into the create loop above) so that an
      // invoice later in the file can already see an earlier invoice in
      // the SAME batch as "already invoiced" quantity when they both
      // reference the same order line -- not just lines within one
      // invoice (handled inside runAutoMatchForInvoice itself).
      let autoMatchedLineCount = 0;
      let overInvoicingFlaggedCount = 0;
      for (const invoiceId of createdInvoiceIds) {
        const matchSummary = await runAutoMatchForInvoice(tx, invoiceId, uploadedById);
        autoMatchedLineCount += matchSummary.matchedCount;
        overInvoicingFlaggedCount += matchSummary.overInvoicingFlagged;
        await recomputeInvoiceHeaderStatus(tx, invoiceId);
      }

      await tx.auditEvent.create({
        data: {
          actorId: uploadedById,
          action: "SAP_INVOICE_IMPORT",
          entityType: "SapInvoiceImportBatch",
          entityId: batch.id,
          afterData: {
            fileName,
            importedInvoiceCount: plan.newInvoices.length,
            importedLineCount: plan.newInvoices.reduce((sum, inv) => sum + inv.group.lines.length, 0),
            duplicateInvoiceCount: plan.duplicateInvoices.length,
            invalidRowCount: plan.invalidRowCount,
            autoMatchedLineCount,
            overInvoicingFlaggedCount,
            unmatchedCustomerCodes: plan.unmatchedCustomerCodes,
            duplicateInvoiceNumbers: plan.duplicateInvoices.map((d) => d.group.docNum),
          },
        },
      });

      return {
        importBatchId: batch.id,
        importedInvoiceCount: plan.newInvoices.length,
        importedLineCount: plan.newInvoices.reduce((sum, inv) => sum + inv.group.lines.length, 0),
        duplicateRowCount: plan.duplicateInvoices.reduce((sum, dup) => sum + dup.group.lines.length, 0),
        invalidRowCount: plan.invalidRowCount,
        autoMatchedLineCount,
        overInvoicingFlaggedCount,
        unmatchedCustomerCodes: plan.unmatchedCustomerCodes,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );

  return result;
}
