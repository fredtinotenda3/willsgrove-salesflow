import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { listConsolidatedLostSaleRowsForExport } from "@/lib/lost-sales/consolidated-analytics";
import { LOST_SALE_SOURCE_LABELS, LOST_SALE_REASON_LABELS } from "@/lib/lost-sales/display";
import { buildCsv, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Follow-up fix ("Show returned-claim losses in the same Lost Sales
 * Analytics page, KPIs, charts and reports as shortage-based lost
 * sales... Preserve the separate detailed returned-claims report if it
 * is useful, but the main Lost Sales Analytics must consolidate both
 * sources"). CSV export for the NEW combined-source drilldown table --
 * every confirmed lost-sale row matching the current filters, from BOTH
 * sources, not just one page -- same "export reflects the filtered
 * view, not the pagination" contract as the pre-existing, UNCHANGED
 * app/api/lost-sales/analytics/export/route.ts (the shortage-only
 * export, kept exactly as it was). Any authenticated user may use it,
 * the same access level as the page itself.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const { rows, truncated } = await listConsolidatedLostSaleRowsForExport(parsed.filters);

    const csvRows = rows.map((row) => ({
      source: LOST_SALE_SOURCE_LABELS[row.source] ?? row.source,
      date: row.date,
      customerName: row.customerName,
      sapItemCode: row.sapItemCodeSnapshot ?? "",
      productDescription: row.productDescriptionSnapshot ?? "",
      quantity: row.quantity,
      unitOfMeasure: row.unitOfMeasure ?? "",
      unitPrice: row.unitPrice ?? "",
      totalValue: row.totalValue ?? "",
      currencyCode: row.currencyCode ?? "UNKNOWN",
      orderReference: row.orderReference ?? "",
      claimReference: row.claimReference ?? "",
      returnReference: row.returnReference ?? "",
      reasonOrCondition: row.reason ? (LOST_SALE_REASON_LABELS[row.reason] ?? row.reason) : row.condition ?? "",
    }));

    const csv = buildCsv(csvRows, [
      { key: "source", header: "Source" },
      { key: "date", header: "Date" },
      { key: "customerName", header: "Customer" },
      { key: "sapItemCode", header: "SAP item code" },
      { key: "productDescription", header: "Product" },
      { key: "quantity", header: "Quantity" },
      { key: "unitOfMeasure", header: "Unit of measure" },
      { key: "unitPrice", header: "Unit price" },
      { key: "totalValue", header: "Total value" },
      { key: "currencyCode", header: "Currency" },
      { key: "orderReference", header: "Order" },
      { key: "claimReference", header: "Claim" },
      { key: "returnReference", header: "Return" },
      { key: "reasonOrCondition", header: "Reason / condition" },
    ]);

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "lost-sales-consolidated-analytics",
      filters: { ...parsed.filters, truncated },
      rowCount: csvRows.length,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders("lost-sales-consolidated-analytics") });
  } catch (error) {
    console.error("Consolidated lost-sales analytics export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the consolidated lost-sales drilldown." }, { status: 500 });
  }
}
