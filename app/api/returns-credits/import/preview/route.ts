import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import {
  applyCreditNoteColumnMapping,
  groupIntoCreditNotes,
  parseCreditNoteCsvForPreview,
  suggestCreditNoteColumnMapping,
  validateCreditNoteColumnMapping,
  type CreditNoteColumnMapping,
} from "@/lib/returns-credits/csv";
import { planCreditNoteImport, readCreditNoteCsvUpload } from "@/lib/returns-credits/plan-import";

const SAMPLE_LIMIT = 20;
const ERROR_LIMIT = 100;

/**
 * Milestone 6B (Returns & Credit Notes). Stateless two-stage preview,
 * mirroring app/api/invoice-reconciliation/import/preview/route.ts's own
 * shape exactly:
 *
 *  - no `mapping` field in the form: returns the raw header row, a
 *    best-guess suggested mapping, and sample rows for the mapping UI.
 *  - a `mapping` field present (the operator's confirmed mapping, as a
 *    JSON string): applies it, groups rows into credit notes, and runs
 *    the full duplicate/base-invoice-resolution plan against the
 *    database -- still no write.
 *
 * Confirmed design decision: restricted to SALES_MANAGER/ADMINISTRATOR,
 * unlike Milestone 5's own invoice import (open to any user) -- recording
 * a credit note is the approval-weight action here, and the import
 * pipeline is just another path into the same CreditNote model as the
 * manual-entry route, so it carries the same gate.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const upload = await readCreditNoteCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const mappingRaw = formData.get("mapping");

    if (typeof mappingRaw !== "string" || mappingRaw.trim() === "") {
      const preview = parseCreditNoteCsvForPreview(upload.csvText);
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
          suggestedMapping: suggestCreditNoteColumnMapping(preview.preview.sourceHeaders),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    let mapping: CreditNoteColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return Response.json({ success: false, message: "Invalid column mapping." }, { status: 400 });
    }

    const preview = parseCreditNoteCsvForPreview(upload.csvText);
    if (!preview.ok) {
      return Response.json({ success: false, message: preview.message }, { status: 422 });
    }

    const mappingCheck = validateCreditNoteColumnMapping(mapping, preview.preview.sourceHeaders);
    if (!mappingCheck.ok) {
      return Response.json({ success: false, message: mappingCheck.message }, { status: 422 });
    }

    const { rows, errors } = applyCreditNoteColumnMapping(upload.csvText, mapping);
    const groups = groupIntoCreditNotes(rows);
    const plan = await planCreditNoteImport(groups, errors.length);

    return Response.json(
      {
        success: true,
        stage: "plan",
        fileName: upload.fileName,
        mapping,
        summary: {
          totalDataRows: preview.preview.totalDataRows,
          invalidRowCount: errors.length,
          newCreditNoteCount: plan.newCreditNotes.length,
          duplicateCreditNoteCount: plan.duplicateCreditNotes.length,
          unresolvedBaseInvoiceReferenceCount: plan.unresolvedBaseInvoiceReferences.length,
        },
        invalidRowErrors: errors.slice(0, ERROR_LIMIT).map((e) => e.message),
        invalidRowErrorsTruncated: errors.length > ERROR_LIMIT,
        newCreditNoteSample: plan.newCreditNotes.slice(0, SAMPLE_LIMIT).map((cn) => ({
          docNum: cn.group.docNum,
          docEntry: cn.group.docEntry,
          baseInvoiceDocEntry: cn.group.baseInvoiceDocEntry,
          baseInvoiceDocNum: cn.group.baseInvoiceDocNum,
          resolvedSapInvoiceId: cn.resolvedSapInvoiceId,
          amount: cn.group.amount,
          currency: cn.group.currency,
          creditNoteDate: cn.group.creditNoteDate,
        })),
        duplicateCreditNoteSample: plan.duplicateCreditNotes.slice(0, SAMPLE_LIMIT).map((dup) => ({
          docNum: dup.group.docNum,
          docEntry: dup.group.docEntry,
          reason: dup.reason,
        })),
        unresolvedBaseInvoiceReferences: plan.unresolvedBaseInvoiceReferences,
        sampleLimit: SAMPLE_LIMIT,
        importExecuted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Credit note import preview failed:", error);
    return Response.json({ success: false, message: "Unable to preview this credit note export." }, { status: 500 });
  }
}
