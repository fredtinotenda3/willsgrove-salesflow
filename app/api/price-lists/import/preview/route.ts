import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapPriceListCsv } from "@/lib/sap-price-list-csv";
import { parseSapPriceListXlsxBuffer } from "@/lib/sap-price-list-xlsx";
import { planPriceListImport, readPriceListFileUpload } from "@/lib/price-list-import";

const SAMPLE_LIMIT = 20;
const ERROR_LIMIT = 100;

export async function POST(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const upload = await readPriceListFileUpload(formData);

    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    // Both parsers return the same {success, rows, errors, totalRows}
    // shape (lib/sap-price-list-xlsx.ts's PriceListXlsxParseResult is a
    // superset -- `sheets`/`skippedBlankPriceCount` are extra, ignored by
    // everything below that only destructures the shared fields), so the
    // rest of this route doesn't need to know which format was uploaded.
    const parsed = upload.kind === "csv" ? parseSapPriceListCsv(upload.csvText) : await parseSapPriceListXlsxBuffer(upload.buffer);

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message:
            upload.kind === "csv"
              ? "The price-list CSV file contains validation errors."
              : "The price-list Excel file contains validation errors.",
          fileName: upload.fileName,
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          errorCount: parsed.errors.length,
          errors: parsed.errors.slice(0, ERROR_LIMIT),
          errorsTruncated: parsed.errors.length > ERROR_LIMIT,
        },
        { status: 422 }
      );
    }

    const plan = await planPriceListImport(parsed.rows);

    return Response.json(
      {
        success: true,
        message: upload.kind === "csv" ? "Price-list CSV validated successfully." : "Price-list Excel file validated successfully.",
        fileName: upload.fileName,
        summary: {
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          newLists: plan.newLists.length,
          changedLists: plan.changedLists.length,
          newEntries: plan.newEntries.length,
          changedEntries: plan.changedEntries.length,
          unchangedEntries: plan.unchangedEntryCount,
          unmatchedItemCodes: plan.unmatchedItemCodes.length,
        },
        newLists: plan.newLists,
        changedLists: plan.changedLists,
        newEntriesSample: plan.newEntries.slice(0, SAMPLE_LIMIT).map((e) => ({
          priceListCode: e.row.priceListCode,
          itemCode: e.row.itemCode,
          unitPrice: e.row.unitPrice,
          currencyCode: e.row.currencyCode,
          validFrom: e.row.validFrom,
          validTo: e.row.validTo,
        })),
        changedEntriesSample: plan.changedEntries.slice(0, SAMPLE_LIMIT).map((c) => ({
          priceListCode: c.key.priceListCode,
          itemCode: c.key.itemCode,
          validFrom: c.key.validFrom,
          current: c.current,
          incoming: { unitPrice: c.incoming.unitPrice, validTo: c.incoming.validTo },
        })),
        unmatchedItemCodes: plan.unmatchedItemCodes.slice(0, SAMPLE_LIMIT),
        sampleLimit: SAMPLE_LIMIT,
        importExecuted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Price list import preview failed:", error);
    return Response.json({ success: false, message: "Unable to preview the price list import." }, { status: 500 });
  }
}
