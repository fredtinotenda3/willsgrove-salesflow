import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapProductCsv } from "@/lib/sap-product-csv";
import {
  planProductImport,
  readSapCsvUpload,
} from "@/lib/product-import";

const SAMPLE_LIMIT = 20;
const WARNING_LIMIT = 50;
const ERROR_LIMIT = 100;

// Read-only (no database writes -- see executeProductImport in the sibling
// /import route for the actual write path), so this intentionally checks
// authentication only and not CSRF: CSRF protection in this codebase is
// reserved for state-changing requests.
export async function POST(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

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
          errors: parsed.errors.slice(0, ERROR_LIMIT),
          errorsTruncated: parsed.errors.length > ERROR_LIMIT,
          duplicateCodes: parsed.duplicateCodes.slice(0, ERROR_LIMIT),
        },
        { status: 422 }
      );
    }

    const plan = await planProductImport(parsed.products);

    const warningsByField = {
      barcode: parsed.warnings.filter((w) => w.field === "BARCODE").length,
      description: parsed.warnings.filter(
        (w) => w.field === "ITEM DESCRIPTION"
      ).length,
    };

    return Response.json(
      {
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
          warningsByField,
        },
        newSample: plan.newProducts.slice(0, SAMPLE_LIMIT).map((p) => ({
          sapItemCode: p.sapItemCode,
          itemName: p.itemName,
          barcode: p.barcode,
          category: p.category,
        })),
        changedSample: plan.changedProducts
          .slice(0, SAMPLE_LIMIT)
          .map((c) => ({
            sapItemCode: c.sapItemCode,
            current: {
              itemName: c.current.itemName,
              barcode: c.current.barcode,
              category: c.current.category,
            },
            incoming: {
              itemName: c.incoming.itemName,
              barcode: c.incoming.barcode,
              category: c.incoming.category,
            },
          })),
        warnings: parsed.warnings.slice(0, WARNING_LIMIT),
        warningsTruncated: parsed.warnings.length > WARNING_LIMIT,
        sampleLimit: SAMPLE_LIMIT,
        importExecuted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
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