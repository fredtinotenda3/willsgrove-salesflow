import { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapTaxCodeCsv } from "@/lib/sap-tax-code-csv";
import {
  executeTaxCodeImport,
  planTaxCodeImport,
  readTaxCodeCsvUpload,
} from "@/lib/tax-code-import";

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

    const expectedNew = readCount(formData.get("expectedNewCodes"));
    const expectedChanged = readCount(formData.get("expectedChangedCodes"));

    if (expectedNew === null || expectedChanged === null) {
      return Response.json(
        {
          success: false,
          message:
            "Run a preview first and send its new and changed counts to confirm the import.",
        },
        { status: 400 }
      );
    }

    const upload = await readTaxCodeCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const parsed = parseSapTaxCodeCsv(upload.csvText);
    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The tax-code CSV file contains validation errors. Nothing was imported.",
          errorCount: parsed.errors.length,
          errors: parsed.errors,
          duplicateCodes: parsed.duplicateCodes,
        },
        { status: 422 }
      );
    }

    const plan = await planTaxCodeImport(parsed.rows);

    if (plan.newCodes.length !== expectedNew || plan.changedCodes.length !== expectedChanged) {
      return Response.json(
        {
          success: false,
          message:
            "The tax-code data has changed since the preview. Nothing was imported. Please run the preview again.",
          expected: { newCodes: expectedNew, changedCodes: expectedChanged },
          actual: { newCodes: plan.newCodes.length, changedCodes: plan.changedCodes.length },
        },
        { status: 409 }
      );
    }

    if (plan.newCodes.length === 0 && plan.changedCodes.length === 0) {
      return Response.json({
        success: true,
        message: "Nothing to import. All tax codes are already up to date.",
        fileName: upload.fileName,
        summary: { created: 0, updated: 0, unchanged: plan.unchangedCodes.length },
        importExecuted: false,
      });
    }

    const result = await executeTaxCodeImport(plan, upload.fileName);

    return Response.json({
      success: true,
      message: "Tax code import completed.",
      fileName: upload.fileName,
      summary: { created: result.created, updated: result.updated, unchanged: result.unchanged },
      auditEventId: result.auditEventId,
      importExecuted: true,
    });
  } catch (error) {
    console.error("Tax code import failed:", error);
    return Response.json(
      { success: false, message: "The tax code import failed. No changes were saved." },
      { status: 500 }
    );
  }
}
