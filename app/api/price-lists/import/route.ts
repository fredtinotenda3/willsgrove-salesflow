import { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseSapPriceListCsv } from "@/lib/sap-price-list-csv";
import {
  executePriceListImport,
  planPriceListImport,
  readPriceListCsvUpload,
} from "@/lib/price-list-import";

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

    const expectedNewEntries = readCount(formData.get("expectedNewEntries"));
    const expectedChangedEntries = readCount(formData.get("expectedChangedEntries"));

    if (expectedNewEntries === null || expectedChangedEntries === null) {
      return Response.json(
        { success: false, message: "Run a preview first and send its counts to confirm the import." },
        { status: 400 }
      );
    }

    const upload = await readPriceListCsvUpload(formData);
    if (!upload.ok) {
      return Response.json({ success: false, message: upload.message }, { status: upload.status });
    }

    const parsed = parseSapPriceListCsv(upload.csvText);
    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message: "The price-list CSV file contains validation errors. Nothing was imported.",
          errorCount: parsed.errors.length,
          errors: parsed.errors,
        },
        { status: 422 }
      );
    }

    const plan = await planPriceListImport(parsed.rows);

    if (plan.newEntries.length !== expectedNewEntries || plan.changedEntries.length !== expectedChangedEntries) {
      return Response.json(
        {
          success: false,
          message:
            "The price-list data has changed since the preview. Nothing was imported. Please run the preview again.",
        },
        { status: 409 }
      );
    }

    if (
      plan.newLists.length === 0 &&
      plan.changedLists.length === 0 &&
      plan.newEntries.length === 0 &&
      plan.changedEntries.length === 0
    ) {
      return Response.json({
        success: true,
        message: "Nothing to import. All price lists and entries are already up to date.",
        fileName: upload.fileName,
        summary: {
          listsCreated: 0,
          listsUpdated: 0,
          entriesCreated: 0,
          entriesUpdated: 0,
          entriesUnchanged: plan.unchangedEntryCount,
        },
        importExecuted: false,
      });
    }

    const result = await executePriceListImport(plan, upload.fileName);

    return Response.json({
      success: true,
      message: "Price list import completed.",
      fileName: upload.fileName,
      summary: {
        listsCreated: result.listsCreated,
        listsUpdated: result.listsUpdated,
        entriesCreated: result.entriesCreated,
        entriesUpdated: result.entriesUpdated,
        entriesUnchanged: result.entriesUnchanged,
      },
      auditEventId: result.auditEventId,
      importExecuted: true,
    });
  } catch (error) {
    console.error("Price list import failed:", error);
    return Response.json(
      { success: false, message: "The price list import failed. No changes were saved." },
      { status: 500 }
    );
  }
}
