import { NextRequest } from "next/server";
import { parseSapProductCsv } from "@/lib/sap-product-csv";
import {
  planProductImport,
  readSapCsvUpload,
} from "@/lib/product-import";


export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
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
          message: "The SAP CSV file contains validation errors.",
          fileName: upload.fileName,
          totalRows: parsed.totalRows,
          validRows: parsed.products.length,
          errorCount: parsed.errors.length,
          warningCount: parsed.warnings.length,
          errors: parsed.errors,
          warnings: parsed.warnings,
          duplicateCodes: parsed.duplicateCodes,
        },
        { status: 422 }
      );
    }

    const plan = await planProductImport(parsed.products);

    return Response.json({
      success: true,
      message: "SAP product CSV validated successfully.",
      fileName: upload.fileName,
      summary: {
        totalRows: parsed.totalRows,
        validRows: parsed.products.length,
        newProducts: plan.newProducts.length,
        changedProducts: plan.changedProducts.length,
        unchangedProducts: plan.unchangedProducts.length,
        errorCount: parsed.errors.length,
        warningCount: parsed.warnings.length,
      },
      newProducts: plan.newProducts,
      changedProducts: plan.changedProducts,
      unchangedProducts: plan.unchangedProducts,
      errors: parsed.errors,
      warnings: parsed.warnings,
      duplicateCodes: parsed.duplicateCodes,
      importExecuted: false,
    });
  } catch (error) {
    console.error("SAP product import preview failed:", error);

    return Response.json(
      {
        success: false,
        message: "Unable to preview the SAP product import.",
      },
      { status: 500 }
    );
  }
}