import { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapItemMasterCsv } from "@/lib/sap-item-master-csv";
import {
  executeItemMasterImport,
  planItemMasterImport,
  readItemMasterCsvUpload,
} from "@/lib/item-master-import";

function readCount(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();

    const expectedChanged = readCount(formData.get("expectedChangedItems"));
    const expectedUnmatched = readCount(formData.get("expectedUnmatchedCodes"));

    if (expectedChanged === null || expectedUnmatched === null) {
      return Response.json(
        {
          success: false,
          message: "Run a preview first and send its counts to confirm the import.",
        },
        { status: 400 }
      );
    }

    const upload = await readItemMasterCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const parsed = parseSapItemMasterCsv(upload.csvText);
    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The item-master CSV file contains validation errors. Nothing was imported.",
          errorCount: parsed.errors.length,
          errors: parsed.errors,
          duplicateCodes: parsed.duplicateCodes,
        },
        { status: 422 }
      );
    }

    const plan = await planItemMasterImport(parsed.rows);

    if (
      plan.changedItems.length !== expectedChanged ||
      plan.unmatchedCodes.length !== expectedUnmatched
    ) {
      return Response.json(
        {
          success: false,
          message:
            "The item master data has changed since the preview. Nothing was imported. Please run the preview again.",
        },
        { status: 409 }
      );
    }

    if (plan.changedItems.length === 0) {
      return Response.json({
        success: true,
        message: "Nothing to import. All matched items are already up to date.",
        fileName: upload.fileName,
        summary: { updated: 0, unchanged: plan.unchangedItems.length, unmatched: plan.unmatchedCodes.length },
        importExecuted: false,
      });
    }

    const result = await executeItemMasterImport(plan, upload.fileName);

    return Response.json({
      success: true,
      message: "Item master import completed.",
      fileName: upload.fileName,
      summary: { updated: result.updated, unchanged: result.unchanged, unmatched: result.unmatched },
      auditEventId: result.auditEventId,
      importExecuted: true,
    });
  } catch (error) {
    console.error("Item master import failed:", error);
    return Response.json(
      { success: false, message: "The item master import failed. No changes were saved." },
      { status: 500 }
    );
  }
}
