import { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import {
  applyCreditNoteColumnMapping,
  groupIntoCreditNotes,
  parseCreditNoteCsvForPreview,
  validateCreditNoteColumnMapping,
  type CreditNoteColumnMapping,
} from "@/lib/returns-credits/csv";
import { planCreditNoteImport, readCreditNoteCsvUpload } from "@/lib/returns-credits/plan-import";
import { executeCreditNoteImport } from "@/lib/returns-credits/execute-import";

function readCount(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * Milestone 6B (Returns & Credit Notes). Confirms and writes a
 * previously-previewed credit note import -- re-parses and re-plans the
 * same file (preview never wrote anything), then compares the fresh
 * plan's counts against what the operator's preview showed
 * (expectedNewCreditNoteCount/expectedDuplicateCreditNoteCount) as a
 * double-submit guard, mirroring app/api/invoice-reconciliation/import/
 * confirm/route.ts's own expectedNewInvoiceCount/
 * expectedDuplicateInvoiceCount check exactly.
 *
 * Restricted to SALES_MANAGER/ADMINISTRATOR, same as the preview route
 * and the manual-entry route -- this is the same approval-weight action
 * (recording that SAP actually issued a credit note) through a different
 * input path, not a separate, more lightly-gated one.
 */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const formData = await request.formData();

    const expectedNew = readCount(formData.get("expectedNewCreditNoteCount"));
    const expectedDuplicate = readCount(formData.get("expectedDuplicateCreditNoteCount"));
    if (expectedNew === null || expectedDuplicate === null) {
      return Response.json(
        { success: false, message: "Run a preview first and send its counts to confirm the import." },
        { status: 400 }
      );
    }

    const mappingRaw = formData.get("mapping");
    if (typeof mappingRaw !== "string" || mappingRaw.trim() === "") {
      return Response.json({ success: false, message: "A confirmed column mapping is required." }, { status: 400 });
    }
    let mapping: CreditNoteColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return Response.json({ success: false, message: "Invalid column mapping." }, { status: 400 });
    }

    const upload = await readCreditNoteCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
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

    if (plan.newCreditNotes.length !== expectedNew || plan.duplicateCreditNotes.length !== expectedDuplicate) {
      return Response.json(
        {
          success: false,
          message: "The credit note data has changed since the preview (perhaps another import ran). Nothing was imported. Please run the preview again.",
        },
        { status: 409 }
      );
    }

    if (plan.newCreditNotes.length === 0) {
      return Response.json({
        success: true,
        message: "Nothing to import -- every credit note in this file has already been imported.",
        fileName: upload.fileName,
        summary: { importedCreditNoteCount: 0, duplicateRowCount: plan.duplicateCreditNotes.reduce((s, d) => s + d.group.rows.length, 0) },
        importExecuted: false,
      });
    }

    const result = await executeCreditNoteImport(plan, mapping, upload.fileName, user.id);

    return Response.json({
      success: true,
      message: "Credit note import completed.",
      fileName: upload.fileName,
      summary: result,
      importExecuted: true,
    });
  } catch (error) {
    console.error("Credit note import failed:", error);
    return Response.json({ success: false, message: "The credit note import failed. No changes were saved." }, { status: 500 });
  }
}
