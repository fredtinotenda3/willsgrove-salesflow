import { NextRequest } from "next/server";
import { parseSapProductCsv } from "@/lib/sap-product-csv";
import {
  executeProductImport,
  planProductImport,
  readSapCsvUpload,
} from "@/lib/product-import";


function readCount(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }

  return Number(value);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const expectedNew = readCount(formData.get("expectedNewProducts"));
    const expectedChanged = readCount(
      formData.get("expectedChangedProducts")
    );

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

    const upload = await readSapCsvUpload(formData);

    if (!upload.ok) {
      return Response.json(
        { success: false, message: upload.message },
        { status: upload.status }
      );
    }

    const parsed = parseSapProductCsv(upload.csvText);

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The SAP CSV file contains validation errors. Nothing was imported.",
          errorCount: parsed.errors.length,
          errors: parsed.errors,
          duplicateCodes: parsed.duplicateCodes,
        },
        { status: 422 }
      );
    }

    const plan = await planProductImport(parsed.products);

    if (
      plan.newProducts.length !== expectedNew ||
      plan.changedProducts.length !== expectedChanged
    ) {
      return Response.json(
        {
          success: false,
          message:
            "The product data has changed since the preview. Nothing was imported. Please run the preview again.",
          expected: {
            newProducts: expectedNew,
            changedProducts: expectedChanged,
          },
          actual: {
            newProducts: plan.newProducts.length,
            changedProducts: plan.changedProducts.length,
          },
        },
        { status: 409 }
      );
    }

    if (plan.newProducts.length === 0 && plan.changedProducts.length === 0) {
      return Response.json({
        success: true,
        message: "Nothing to import. All products are already up to date.",
        fileName: upload.fileName,
        summary: {
          created: 0,
          updated: 0,
          unchanged: plan.unchangedProducts.length,
        },
        importExecuted: false,
      });
    }

    const result = await executeProductImport(plan, upload.fileName);

    return Response.json({
      success: true,
      message: "SAP product import completed.",
      fileName: upload.fileName,
      summary: {
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
      },
      auditEventId: result.auditEventId,
      importExecuted: true,
    });
  } catch (error) {
    console.error("SAP product import failed:", error);

    return Response.json(
      {
        success: false,
        message: "The SAP product import failed. No changes were saved.",
      },
      { status: 500 }
    );
  }
}