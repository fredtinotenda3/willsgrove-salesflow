import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters, dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { listAllUnfulfilledDemandsForExport } from "@/lib/lost-sales/queries";
import { UNFULFILLED_DEMAND_STATUS_LABELS } from "@/lib/lost-sales/display";
import { multiplyDecimalStrings } from "@/lib/lost-sales/validation";
import { buildCsv, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Additional Implementation Requirements (spec section 3: "Lost Sales
 * Analytics Overhaul", spec section 9's export requirement). CSV export
 * for the analytics page's order-level drilldown table -- every row
 * matching the current filters, not just the one page the UI shows
 * (same "export reflects the filtered view, not the pagination"
 * contract as app/api/reports/decision-intelligence/recommendations/
 * export/route.ts). Any authenticated user may use it, the same access
 * level as GET /api/lost-sales and the /lost-sales list page itself --
 * this page is not management-only.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(parsed.filters);
    const { gte: dateFrom, lt: dateTo } = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

    const { demands, truncated } = await listAllUnfulfilledDemandsForExport({
      includeDemo: parsed.filters.includeDemo,
      status: parsed.filters.unfulfilledDemandStatus ?? undefined,
      customerId: parsed.filters.customerId ?? undefined,
      productId: parsed.filters.productId ?? undefined,
      salespersonId: parsed.filters.salespersonId ?? undefined,
      dateFrom,
      dateTo,
      reason: parsed.filters.lostSalesReason ?? undefined,
    });

    // Follow-up fix: "since now we have prices, the graphs should now
    // have prices too... the quantity should be associated with its
    // price" -- requestedValue/foundValue reuse this demand's own
    // estimatedUnitPrice snapshot (the SAME price already used for
    // estimatedValue, Source B's unavailable-quantity figure), via the
    // one existing decimal-string multiplier this module already trusts
    // for money math (lib/lost-sales/validation.ts's
    // multiplyDecimalStrings -- see lib/lost-sales/estimate-value.ts's
    // own use of it). null (never a fabricated 0) whenever
    // estimatedUnitPrice itself is null, same "never invent a value"
    // rule as estimatedValue.
    const csvRows = demands.map((demand) => ({
      orderReference: demand.orderReference,
      customerName: demand.customerName,
      sapItemCode: demand.sapItemCodeSnapshot ?? "",
      productDescription: demand.productDescriptionSnapshot,
      requestedQuantity: demand.requestedQuantity,
      requestedValue: demand.estimatedUnitPrice ? (multiplyDecimalStrings(demand.estimatedUnitPrice, demand.requestedQuantity) ?? "") : "",
      foundQuantity: demand.foundQuantity,
      foundValue: demand.estimatedUnitPrice ? (multiplyDecimalStrings(demand.estimatedUnitPrice, demand.foundQuantity) ?? "") : "",
      unavailableQuantity: demand.unavailableQuantity,
      outstandingQuantity: demand.outstandingQuantity,
      confirmedLostQuantity: demand.confirmedLostQuantity,
      estimatedUnitPrice: demand.estimatedUnitPrice ?? "",
      currencyCode: demand.currencyCode,
      estimatedValue: demand.estimatedValue ?? "",
      estimatedValueSource: demand.estimatedValueSource ?? "",
      status: UNFULFILLED_DEMAND_STATUS_LABELS[demand.status] ?? demand.status,
      createdAt: demand.createdAt,
    }));

    const csv = buildCsv(csvRows, [
      { key: "orderReference", header: "Order" },
      { key: "customerName", header: "Customer" },
      { key: "sapItemCode", header: "SAP item code" },
      { key: "productDescription", header: "Product" },
      { key: "requestedQuantity", header: "Requested quantity" },
      { key: "requestedValue", header: "Requested value" },
      { key: "foundQuantity", header: "Found quantity" },
      { key: "foundValue", header: "Found value" },
      { key: "unavailableQuantity", header: "Unavailable quantity" },
      { key: "outstandingQuantity", header: "Outstanding quantity" },
      { key: "confirmedLostQuantity", header: "Confirmed lost quantity" },
      // Real-world fix ("lost sales... show unit price/currency"): the
      // unit price this estimate was actually computed from, and the
      // currency every money column on this row is denominated in (this
      // order's own currency -- never assumed to be one global currency
      // across rows, since different customers/orders can use different
      // ones).
      { key: "estimatedUnitPrice", header: "Unit price used" },
      { key: "currencyCode", header: "Currency" },
      { key: "estimatedValue", header: "Estimated lost value" },
      { key: "estimatedValueSource", header: "Estimate source" },
      { key: "status", header: "Status" },
      { key: "createdAt", header: "Created" },
    ]);

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "lost-sales-analytics",
      filters: { ...parsed.filters, effectiveFrom, effectiveTo, truncated },
      rowCount: csvRows.length,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders("lost-sales-analytics") });
  } catch (error) {
    console.error("Lost-sales analytics export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the lost-sales analytics drilldown." }, { status: 500 });
  }
}
