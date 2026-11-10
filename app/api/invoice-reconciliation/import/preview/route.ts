import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import {
  applyColumnMapping,
  groupIntoInvoices,
  parseInvoiceCsvForPreview,
  suggestColumnMapping,
  validateColumnMapping,
  type InvoiceColumnMapping,
} from "@/lib/invoice-reconciliation/csv";
import { planSapInvoiceImport, readSapInvoiceCsvUpload } from "@/lib/invoice-reconciliation/plan-import";

const SAMPLE_LIMIT = 20;
const ERROR_LIMIT = 100;

/**
 * Milestone 5 (SAP Invoice Reconciliation). Stateless two-stage preview
 * (spec section 10.A: "upload, preview, map columns, validate, identify
 * duplicates"), mirroring every Milestone 1 master-data importer's own
 * preview route for the stateless/no-DB-write shape:
 *
 *  - no `mapping` field in the form: returns the raw header row, a
 *    best-guess suggested mapping, and sample rows for the mapping UI.
 *  - a `mapping` field present (the operator's confirmed mapping, as a
 *    JSON string): applies it, groups rows into invoices, and runs the
 *    full duplicate/customer-match plan against the database -- still no
 *    write. Any authenticated user may run this (same "no dedicated
 *    role" convention as the existing master-data importers).
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const upload = await readSapInvoiceCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const mappingRaw = formData.get("mapping");

    if (typeof mappingRaw !== "string" || mappingRaw.trim() === "") {
      const preview = parseInvoiceCsvForPreview(upload.csvText);
      if (!preview.ok) {
        return Response.json({ success: false, message: preview.message }, { status: 422 });
      }

      return Response.json(
        {
          success: true,
          stage: "headers",
          fileName: upload.fileName,
          sourceHeaders: preview.preview.sourceHeaders,
          totalDataRows: preview.preview.totalDataRows,
          sampleRows: preview.preview.sampleRows,
          suggestedMapping: suggestColumnMapping(preview.preview.sourceHeaders),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    let mapping: InvoiceColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return Response.json({ success: false, message: "Invalid column mapping." }, { status: 400 });
    }

    const preview = parseInvoiceCsvForPreview(upload.csvText);
    if (!preview.ok) {
      return Response.json({ success: false, message: preview.message }, { status: 422 });
    }

    const mappingCheck = validateColumnMapping(mapping, preview.preview.sourceHeaders);
    if (!mappingCheck.ok) {
      return Response.json({ success: false, message: mappingCheck.message }, { status: 422 });
    }

    const { rows, errors } = applyColumnMapping(upload.csvText, mapping);
    const groups = groupIntoInvoices(rows);
    const plan = await planSapInvoiceImport(groups, errors.length);

    return Response.json(
      {
        success: true,
        stage: "plan",
        fileName: upload.fileName,
        mapping,
        summary: {
          totalDataRows: preview.preview.totalDataRows,
          invalidRowCount: errors.length,
          newInvoiceCount: plan.newInvoices.length,
          newLineCount: plan.newInvoices.reduce((sum, inv) => sum + inv.group.lines.length, 0),
          duplicateInvoiceCount: plan.duplicateInvoices.length,
          unmatchedCustomerCodeCount: plan.unmatchedCustomerCodes.length,
        },
        invalidRowErrors: errors.slice(0, ERROR_LIMIT).map((e) => e.message),
        invalidRowErrorsTruncated: errors.length > ERROR_LIMIT,
        newInvoiceSample: plan.newInvoices.slice(0, SAMPLE_LIMIT).map((inv) => ({
          docNum: inv.group.docNum,
          docEntry: inv.group.docEntry,
          customerCode: inv.group.customerCode,
          customerName: inv.group.customerName,
          matchedCustomerId: inv.matchedCustomerId,
          invoiceDate: inv.group.invoiceDate,
          lineCount: inv.group.lines.length,
          isCancelledOrReversed: inv.group.isCancelledOrReversed,
        })),
        duplicateInvoiceSample: plan.duplicateInvoices.slice(0, SAMPLE_LIMIT).map((dup) => ({
          docNum: dup.group.docNum,
          docEntry: dup.group.docEntry,
          reason: dup.reason,
        })),
        unmatchedCustomerCodes: plan.unmatchedCustomerCodes,
        sampleLimit: SAMPLE_LIMIT,
        importExecuted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("SAP invoice import preview failed:", error);
    return Response.json({ success: false, message: "Unable to preview this SAP invoice export." }, { status: 500 });
  }
}
