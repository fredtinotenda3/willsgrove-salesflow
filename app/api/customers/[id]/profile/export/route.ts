import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getCustomerProfile } from "@/lib/reporting/customer-insights-queries";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 13 (Customer Intelligence). CSV export for one customer's
 * Customer 360 profile -- SAME access as the profile view itself (all
 * three roles), recorded through the EXISTING report-export audit
 * mechanism (recordReportExport -> AuditEvent), never a new audit
 * architecture.
 *
 * Several headline tables get real columns (same "headline table gets
 * real columns, everything else flattened key/value" split every M11/M12
 * export already established -- see app/api/reports/sales-performance/
 * export/route.ts): revenue by currency, the per-product quantity-by-unit
 * and value-by-currency breakdowns (so SAP item codes, recorded UoM and
 * currency codes are never buried inside one combined cell), the
 * products table itself (product-master match status preserved as its
 * own column), delivery rejections, orders-by-salesperson, and
 * quotation provenance. Everything else (invoice history, lost-sales
 * summary, claims/credit-notes figures, data-quality) is flattened
 * key/value, same as every M11/M12 summary export.
 */
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid customer id." }, { status: 400 });
  }

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const profile = await getCustomerProfile(id, parsed.filters);
    if (!profile) {
      return NextResponse.json({ success: false, message: "Customer not found." }, { status: 404 });
    }

    const identityRows = flattenToKeyValueRows(
      {
        id: profile.customer.id,
        name: profile.customer.name,
        sapCustomerCode: profile.customer.sapCustomerCode,
        category: profile.customer.category,
        status: profile.customer.status,
      },
      "customer"
    );

    const revenueByCurrencyCsv = buildCsv(profile.revenue.byCurrency, [
      { key: "currency", header: "Currency" },
      { key: "lineValueTotal", header: `${profile.revenue.metricLabel} total` },
      { key: "excludedLineCount", header: "Lines excluded (no line value)" },
    ]);

    const historyRows = flattenToKeyValueRows(profile.revenue.history, "invoiceHistory");

    const productsCsv = buildCsv(
      profile.purchasing.products.map((p) => ({
        sapItemCode: p.sapItemCode,
        description: p.description ?? "",
        productMasterMatched: p.productMasterMatch.matched,
        category: p.productMasterMatch.matched ? p.productMasterMatch.category : "",
        purchaseFrequencyInPeriod: p.purchaseFrequencyInPeriod,
        lastPurchasedDateInPeriod: p.lastPurchasedDateInPeriod ?? "",
      })),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "description", header: "Description" },
        { key: "productMasterMatched", header: "Matched to product master" },
        { key: "category", header: "Category" },
        { key: "purchaseFrequencyInPeriod", header: "Purchase frequency (period)" },
        { key: "lastPurchasedDateInPeriod", header: "Last purchased (period)" },
      ]
    );

    const quantityByUnitRows = profile.purchasing.products.flatMap((p) => p.quantityByUnit.map((u) => ({ sapItemCode: p.sapItemCode, unitOfMeasure: u.unitOfMeasure, quantityTotal: u.quantityTotal })));
    const quantityByUnitCsv = buildCsv(quantityByUnitRows, [
      { key: "sapItemCode", header: "SAP item code" },
      { key: "unitOfMeasure", header: "Unit of measure (as recorded on the invoice line)" },
      { key: "quantityTotal", header: "Quantity purchased (period)" },
    ]);

    const valueByCurrencyRows = profile.purchasing.products.flatMap((p) => p.valueByCurrency.map((v) => ({ sapItemCode: p.sapItemCode, currency: v.currency, valueTotal: v.lineValueTotal })));
    const productValueByCurrencyCsv = buildCsv(valueByCurrencyRows, [
      { key: "sapItemCode", header: "SAP item code" },
      { key: "currency", header: "Currency" },
      { key: "valueTotal", header: `${profile.purchasing.metricLabel} total (period)` },
    ]);

    const lostSalesRows = flattenToKeyValueRows(profile.lostSales, "lostSales");

    const healthRows = flattenToKeyValueRows(
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

    const deliveryCsv = buildCsv(profile.commercialHealth.delivery.rejectionsInPeriod, [
      { key: "outcome", header: "Delivery outcome (operational signal, not a commercial dispute)" },
      { key: "count", header: "Count (period)" },
    ]);

    const ordersCsv = buildCsv(
      profile.salespersonRelationship.ordersBySalesperson.map((row) => ({
        salespersonId: row.salespersonId ?? "",
        salespersonName: row.salespersonName,
        orderCount: row.orderCount,
        attributionBreakdown: JSON.stringify(row.attributionBreakdown),
      })),
      [
        { key: "salespersonId", header: "Salesperson ID" },
        { key: "salespersonName", header: "Salesperson" },
        { key: "orderCount", header: "Order count" },
        { key: "attributionBreakdown", header: "Attribution confidence breakdown (reused from M12, never a competing classification)" },
      ]
    );

    const quotationsCsv = buildCsv(profile.salespersonRelationship.quotationProvenance, [
      { key: "quotationId", header: "Quotation ID" },
      { key: "quotationNumber", header: "Quotation number" },
      { key: "revisionNumber", header: "Revision" },
      { key: "salespersonId", header: "Salesperson ID (Quotation.salespersonId, required field -- never attribution-classified)" },
      { key: "salespersonName", header: "Salesperson" },
      { key: "preparedById", header: "Prepared by (user ID)" },
      { key: "preparedByName", header: "Prepared by" },
      { key: "status", header: "Status" },
    ]);

    const dataQualityRows = flattenToKeyValueRows(profile.dataQuality, "dataQuality");

    const summaryCsv = buildCsv([...identityRows, ...historyRows, ...lostSalesRows, ...healthRows, ...dataQualityRows], [
      { key: "metric", header: "Metric" },
      { key: "value", header: "Value" },
    ]);

    const csv = [summaryCsv, revenueByCurrencyCsv, productsCsv, quantityByUnitCsv, productValueByCurrencyCsv, deliveryCsv, ordersCsv, quotationsCsv].join("\r\n");

    const rowCount =
      identityRows.length +
      historyRows.length +
      lostSalesRows.length +
      healthRows.length +
      dataQualityRows.length +
      profile.revenue.byCurrency.length +
      profile.purchasing.products.length +
      quantityByUnitRows.length +
      valueByCurrencyRows.length +
      profile.commercialHealth.delivery.rejectionsInPeriod.length +
      profile.salespersonRelationship.ordersBySalesperson.length +
      profile.salespersonRelationship.quotationProvenance.length;

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "customer-profile",
      filters: { ...parsed.filters, customerId: id },
      rowCount,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders(`customer-${profile.customer.sapCustomerCode ?? id}-profile`) });
  } catch (error) {
    console.error("Customer profile export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the customer profile." }, { status: 500 });
  }
}
