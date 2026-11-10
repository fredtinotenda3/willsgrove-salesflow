import { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import {
  applyColumnMapping,
  groupIntoInvoices,
  parseInvoiceCsvForPreview,
  validateColumnMapping,
  type InvoiceColumnMapping,
} from "@/lib/invoice-reconciliation/csv";
import { planSapInvoiceImport, readSapInvoiceCsvUpload } from "@/lib/invoice-reconciliation/plan-import";
import { executeSapInvoiceImport } from "@/lib/invoice-reconciliation/execute-import";

function readCount(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * Milestone 5 (SAP Invoice Reconciliation). Confirms and writes a
 * previously-previewed import -- re-parses and re-plans the same file
 * (preview never wrote anything, exactly like every Milestone 1
 * master-data importer), then compares the fresh plan's counts against
 * what the operator's preview showed (expectedNewInvoiceCount /
 * expectedDuplicateInvoiceCount) as a double-submit guard, mirroring
 * app/api/customers/master-import/route.ts's own
 * expectedNewCustomers/expectedChangedCustomers check. Any authenticated
 * user may import (no dedicated role -- same convention as the existing
 * master-data importers; manual match/cannot-link actions are the ones
 * gated to SALES_MANAGER/ADMINISTRATOR, not the import itself).
 */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const formData = await request.formData();

    const expectedNew = readCount(formData.get("expectedNewInvoiceCount"));
    const expectedDuplicate = readCount(formData.get("expectedDuplicateInvoiceCount"));
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
    let mapping: InvoiceColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return Response.json({ success: false, message: "Invalid column mapping." }, { status: 400 });
    }

    const upload = await readSapInvoiceCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
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

    if (plan.newInvoices.length !== expectedNew || plan.duplicateInvoices.length !== expectedDuplicate) {
      return Response.json(
        {
          success: false,
          message: "The invoice data has changed since the preview (perhaps another import ran). Nothing was imported. Please run the preview again.",
        },
        { status: 409 }
      );
    }

    if (plan.newInvoices.length === 0) {
      return Response.json({
        success: true,
        message: "Nothing to import -- every invoice in this file has already been imported.",
        fileName: upload.fileName,
        summary: { importedInvoiceCount: 0, duplicateRowCount: plan.duplicateInvoices.reduce((s, d) => s + d.group.lines.length, 0) },
        importExecuted: false,
      });
    }

    const result = await executeSapInvoiceImport(plan, mapping, upload.fileName, user.id);

    return Response.json({
      success: true,
      message: "SAP invoice import completed.",
      fileName: upload.fileName,
      summary: result,
      importExecuted: true,
    });
  } catch (error) {
    console.error("SAP invoice import failed:", error);
    return Response.json({ success: false, message: "The SAP invoice import failed. No changes were saved." }, { status: 500 });
  }
}
