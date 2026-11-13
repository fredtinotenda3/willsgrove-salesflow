import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getProductProfile } from "@/lib/reporting/product-insights-queries";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 14 (Product Intelligence). CSV export for one product's
 * Product 360 profile -- SAME access as the profile view itself (all
 * three roles), recorded through the EXISTING report-export audit
 * mechanism (recordReportExport -> AuditEvent), never a new audit
 * architecture. Same "headline table gets real columns, everything else
 * flattened key/value" split as app/api/customers/[id]/profile/export/route.ts
 * (Milestone 13).
 */
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid product id." }, { status: 400 });
  }

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const profile = await getProductProfile(id, parsed.filters);
    if (!profile) {
      return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });
    }

    const identityRows = flattenToKeyValueRows(
      {
        id: profile.product.id,
        sapItemCode: profile.product.sapItemCode,
        itemName: profile.product.itemName,
        barcode: profile.product.barcode,
        category: profile.product.category,
        status: profile.product.status,
        unitOfMeasure: profile.product.unitOfMeasure,
      },
      "product"
    );

    const revenueByCurrencyCsv = buildCsv(profile.revenue.byCurrency, [
      { key: "currency", header: "Currency" },
      { key: "lineValueTotal", header: `${profile.revenue.metricLabel} total` },
      { key: "excludedLineCount", header: "Lines excluded (no line value)" },
    ]);

    const quantityByUnitCsv = buildCsv(profile.revenue.quantityByUnit, [
      { key: "unitOfMeasure", header: "Unit of measure (as recorded on the invoice line)" },
      { key: "quantityTotal", header: "Quantity invoiced (period)" },
    ]);

    const historyRows = flattenToKeyValueRows(profile.revenue.history, "invoiceHistory");

    const customersCsv = buildCsv(
      profile.customerDemand.customers.map((c) => ({ customerId: c.customerId, customerName: c.customerName, purchaseFrequency: c.purchaseFrequency, lastPurchaseDate: c.lastPurchaseDate ?? "" })),
      [
        { key: "customerId", header: "Customer ID" },
        { key: "customerName", header: "Customer" },
        { key: "purchaseFrequency", header: "Purchase frequency (period, distinct invoices)" },
        { key: "lastPurchaseDate", header: "Last purchase date (period)" },
      ]
    );

    const requestedDemandRows = flattenToKeyValueRows(profile.requestedDemand, "requestedDemand");

    const lostSalesRows = flattenToKeyValueRows(profile.lostSales, "lostSales");

    const commercialHealthRows = flattenToKeyValueRows(
      {
        periodFrom: profile.commercialHealth.periodFrom,
        periodTo: profile.commercialHealth.periodTo,
        asOfDate: profile.commercialHealth.asOfDate,
        asOfDateSource: profile.commercialHealth.asOfDateSource,
        claims: profile.commercialHealth.claims,
        returns: profile.commercialHealth.returns,
        actualCreditNotes: profile.commercialHealth.actualCreditNotes,
      },
      "commercialHealth"
    );

    const fulfilmentRows = flattenToKeyValueRows(
      {
        periodFrom: profile.fulfilment.periodFrom,
        periodTo: profile.fulfilment.periodTo,
        dispatchedQuantityByUnit: profile.fulfilment.dispatchedQuantityByUnit,
        deliveredAcceptedQuantityByUnit: profile.fulfilment.deliveredAcceptedQuantityByUnit,
        deliveredRejectedQuantityByUnit: profile.fulfilment.deliveredRejectedQuantityByUnit,
        deliveryLinesWithRejectionCount: profile.fulfilment.deliveryLinesWithRejectionCount,
      },
      "fulfilment"
    );

    const rejectionReasonsCsv = buildCsv(profile.fulfilment.rejectionReasons, [
      { key: "reason", header: "Rejection reason (free text, as recorded)" },
      { key: "count", header: "Count (period)" },
    ]);

    const insightsCsv = buildCsv(
      profile.insights.map((i) => ({ category: i.category, reason: i.reason, periodFrom: i.period.from, periodTo: i.period.to, supportingMetrics: JSON.stringify(i.supportingMetrics), dataLimitations: i.dataLimitations ?? "" })),
      [
        { key: "category", header: "Insight category" },
        { key: "reason", header: "Reason (deterministic, explainable -- spec section 7)" },
        { key: "periodFrom", header: "Period from" },
        { key: "periodTo", header: "Period to" },
        { key: "supportingMetrics", header: "Supporting metrics" },
        { key: "dataLimitations", header: "Data limitations" },
      ]
    );

    const summaryCsv = buildCsv([...identityRows, ...historyRows, ...requestedDemandRows, ...lostSalesRows, ...commercialHealthRows, ...fulfilmentRows], [
      { key: "metric", header: "Metric" },
      { key: "value", header: "Value" },
    ]);

    const csv = [summaryCsv, revenueByCurrencyCsv, quantityByUnitCsv, customersCsv, rejectionReasonsCsv, insightsCsv].join("\r\n");

    const rowCount =
      identityRows.length +
      historyRows.length +
      requestedDemandRows.length +
      lostSalesRows.length +
      commercialHealthRows.length +
      fulfilmentRows.length +
      profile.revenue.byCurrency.length +
      profile.revenue.quantityByUnit.length +
      profile.customerDemand.customers.length +
      profile.fulfilment.rejectionReasons.length +
      profile.insights.length;

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "product-profile",
      filters: { ...parsed.filters, productId: id },
      rowCount,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders(`product-${profile.product.sapItemCode}-profile`) });
  } catch (error) {
    console.error("Product profile export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the product profile." }, { status: 500 });
  }
}
