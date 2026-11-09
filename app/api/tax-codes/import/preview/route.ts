import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapTaxCodeCsv } from "@/lib/sap-tax-code-csv";
import { planTaxCodeImport, readTaxCodeCsvUpload } from "@/lib/tax-code-import";

const SAMPLE_LIMIT = 20;
const ERROR_LIMIT = 100;

// Read-only (no database writes) -- CSRF protection in this codebase is
// reserved for state-changing requests, same as /api/products/import/preview.
export async function POST(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const upload = await readTaxCodeCsvUpload(formData);

    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const parsed = parseSapTaxCodeCsv(upload.csvText);

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The tax-code CSV file contains validation errors.",
          fileName: upload.fileName,
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          errorCount: parsed.errors.length,
          errors: parsed.errors.slice(0, ERROR_LIMIT),
          errorsTruncated: parsed.errors.length > ERROR_LIMIT,
          duplicateCodes: parsed.duplicateCodes.slice(0, ERROR_LIMIT),
        },
        { status: 422 }
      );
    }

    const plan = await planTaxCodeImport(parsed.rows);

    return Response.json(
      {
        success: true,
        message: "Tax-code CSV validated successfully.",
        fileName: upload.fileName,
        summary: {
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          newCodes: plan.newCodes.length,
          changedCodes: plan.changedCodes.length,
          unchangedCodes: plan.unchangedCodes.length,
          errorCount: parsed.errors.length,
        },
        newSample: plan.newCodes.slice(0, SAMPLE_LIMIT),
        changedSample: plan.changedCodes.slice(0, SAMPLE_LIMIT).map((c) => ({
          code: c.code,
          current: c.current,
          incoming: { code: c.incoming.code, description: c.incoming.description, ratePercent: c.incoming.ratePercent },
        })),
        sampleLimit: SAMPLE_LIMIT,
        importExecuted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Tax code import preview failed:", error);
    return Response.json({ success: false, message: "Unable to preview the tax code import." }, { status: 500 });
  }
}
