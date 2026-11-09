import { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapCustomerMasterCsv } from "@/lib/sap-customer-master-csv";
import {
  executeCustomerMasterImport,
  planCustomerMasterImport,
  readCustomerMasterCsvUpload,
} from "@/lib/customer-master-import";

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

    const expectedNew = readCount(formData.get("expectedNewCustomers"));
    const expectedChanged = readCount(formData.get("expectedChangedCustomers"));

    if (expectedNew === null || expectedChanged === null) {
      return Response.json(
        { success: false, message: "Run a preview first and send its counts to confirm the import." },
        { status: 400 }
      );
    }

    const upload = await readCustomerMasterCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const parsed = parseSapCustomerMasterCsv(upload.csvText);
    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The customer-master CSV file contains validation errors. Nothing was imported.",
          errorCount: parsed.errors.length,
          errors: parsed.errors,
          duplicateCodes: parsed.duplicateCodes,
        },
        { status: 422 }
      );
    }

    const plan = await planCustomerMasterImport(parsed.rows);

    if (plan.newCustomers.length !== expectedNew || plan.changedCustomers.length !== expectedChanged) {
      return Response.json(
        {
          success: false,
          message:
            "The customer master data has changed since the preview. Nothing was imported. Please run the preview again.",
        },
        { status: 409 }
      );
    }

    if (plan.newCustomers.length === 0 && plan.changedCustomers.length === 0) {
      return Response.json({
        success: true,
        message: "Nothing to import. All customers are already up to date.",
        fileName: upload.fileName,
        summary: { created: 0, updated: 0, unchanged: plan.unchangedCount },
        importExecuted: false,
      });
    }

    const result = await executeCustomerMasterImport(plan, upload.fileName);

    return Response.json({
      success: true,
      message: "Customer master import completed.",
      fileName: upload.fileName,
      summary: { created: result.created, updated: result.updated, unchanged: result.unchanged },
      auditEventId: result.auditEventId,
      importExecuted: true,
    });
  } catch (error) {
    console.error("Customer master import failed:", error);
    return Response.json(
      { success: false, message: "The customer master import failed. No changes were saved." },
      { status: 500 }
    );
  }
}
