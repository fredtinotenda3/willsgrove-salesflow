import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapItemMasterCsv } from "@/lib/sap-item-master-csv";
import { planItemMasterImport, readItemMasterCsvUpload } from "@/lib/item-master-import";

const SAMPLE_LIMIT = 20;
const WARNING_LIMIT = 50;
const ERROR_LIMIT = 100;

export async function POST(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const upload = await readItemMasterCsvUpload(formData);

    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const parsed = parseSapItemMasterCsv(upload.csvText);

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The item-master CSV file contains validation errors.",
          fileName: upload.fileName,
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          errorCount: parsed.errors.length,
          warningCount: parsed.warnings.length,
          errors: parsed.errors.slice(0, ERROR_LIMIT),
          errorsTruncated: parsed.errors.length > ERROR_LIMIT,
          duplicateCodes: parsed.duplicateCodes.slice(0, ERROR_LIMIT),
        },
        { status: 422 }
      );
    }

    const plan = await planItemMasterImport(parsed.rows);

    return Response.json(
      {
        success: true,
        message: "Item-master CSV validated successfully.",
        fileName: upload.fileName,
        summary: {
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          changedItems: plan.changedItems.length,
          unchangedItems: plan.unchangedItems.length,
          unmatchedCodes: plan.unmatchedCodes.length,
          unknownTaxCodes: plan.unknownTaxCodes.length,
          warningCount: parsed.warnings.length,
        },
        changedSample: plan.changedItems.slice(0, SAMPLE_LIMIT).map((c) => ({
          code: c.code,
          current: c.current,
          incoming: {
            unitOfMeasure: c.incoming.unitOfMeasure,
            packSize: c.incoming.packSize,
            isVariableWeight: c.incoming.isVariableWeight,
            vatCode: c.incoming.vatCode,
          },
        })),
        unmatchedSample: plan.unmatchedCodes.slice(0, SAMPLE_LIMIT),
        unknownTaxCodes: plan.unknownTaxCodes,
        warnings: parsed.warnings.slice(0, WARNING_LIMIT),
        warningsTruncated: parsed.warnings.length > WARNING_LIMIT,
        sampleLimit: SAMPLE_LIMIT,
        importExecuted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Item master import preview failed:", error);
    return Response.json({ success: false, message: "Unable to preview the item master import." }, { status: 500 });
  }
}
