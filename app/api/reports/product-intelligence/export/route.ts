import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getProductIntelligenceOverview } from "@/lib/reporting/product-insights-queries";
import { buildCsv, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 14 (Product Intelligence). CSV export for the management
 * overview -- SALES_MANAGER/ADMINISTRATOR only, same access as the view.
 *
 * Spec section 15/9: exports ALL filtered products across EVERY
 * dimension, never only the current screen page -- the view route
 * (../route.ts) paginates the largest dimension in memory for the
 * screen; this route deliberately does not. Each of the ten spec
 * section 4.B dimensions gets its own CSV table (never merged into one
 * row set, same "never combine into one composite score" rule the query
 * layer already follows), joined with a blank line between tables --
 * same convention as every other multi-table M11-M13 export.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const parsedFilters = parseReportFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ success: false, message: parsedFilters.message }, { status: 400 });
  }

  try {
    const report = await getProductIntelligenceOverview(parsedFilters.filters);

    // Items 1-4.
    const revenueRows = report.revenueQuantityFrequencyCustomers.rows.flatMap((row) =>
      row.revenueByCurrency.map((rev) => ({ sapItemCode: row.sapItemCode, description: row.description ?? "", currency: rev.currency, lineValueTotal: rev.lineValueTotal, rank: rev.rank }))
    );
    const revenueCsv = buildCsv(revenueRows, [
      { key: "sapItemCode", header: "SAP item code" },
      { key: "description", header: "Description" },
      { key: "currency", header: "Currency" },
      { key: "lineValueTotal", header: `${report.metricLabel} total (period)` },
      { key: "rank", header: "Rank within this currency" },
    ]);

    const quantityRows = report.revenueQuantityFrequencyCustomers.rows.flatMap((row) =>
      row.quantityByUnit.map((q) => ({ sapItemCode: row.sapItemCode, unitOfMeasure: q.unitOfMeasure, quantityTotal: q.quantityTotal, rank: q.rank }))
    );
    const quantityCsv = buildCsv(quantityRows, [
      { key: "sapItemCode", header: "SAP item code" },
      { key: "unitOfMeasure", header: "Unit of measure (as recorded on the invoice line)" },
      { key: "quantityTotal", header: "Quantity invoiced (period)" },
      { key: "rank", header: "Rank within this unit of measure" },
    ]);

    const frequencyAndCustomersCsv = buildCsv(
      report.revenueQuantityFrequencyCustomers.rows.map((row) => ({
        sapItemCode: row.sapItemCode,
        description: row.description ?? "",
        productId: row.productId ?? "",
        productMasterMatched: row.productMasterMatched,
        invoiceFrequencyInPeriod: row.invoiceFrequencyInPeriod,
        invoiceFrequencyRank: row.invoiceFrequencyRank,
        distinctCustomerCountInPeriod: row.distinctCustomerCountInPeriod,
        distinctCustomerCountRank: row.distinctCustomerCountRank,
      })),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "description", header: "Description" },
        { key: "productId", header: "Product master ID" },
        { key: "productMasterMatched", header: "Matched to product master" },
        { key: "invoiceFrequencyInPeriod", header: "Invoice frequency (period)" },
        { key: "invoiceFrequencyRank", header: "Frequency rank" },
        { key: "distinctCustomerCountInPeriod", header: "Distinct purchasing customers (period)" },
        { key: "distinctCustomerCountRank", header: "Distinct customer count rank" },
      ]
    );

    // Item 5.
    const lostSalesCsv = buildCsv(
      report.lostSalesActivity.rows.map((r) => ({ sapItemCode: r.sapItemCode, productId: r.productId ?? "", confirmedLostSaleCount: r.confirmedLostSaleCount, confirmedLostSaleQuantityTotal: r.confirmedLostSaleQuantityTotal, rank: r.rank })),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "productId", header: "Product master ID" },
        { key: "confirmedLostSaleCount", header: "Confirmed lost-sale count (period)" },
        { key: "confirmedLostSaleQuantityTotal", header: "Confirmed lost-sale quantity total (period)" },
        { key: "rank", header: "Rank" },
      ]
    );

    // Item 6.
    const claimReturnCsv = buildCsv(
      report.claimAndReturnActivity.rows.map((r) => ({ sapItemCode: r.sapItemCode, productId: r.productId ?? "", claimCount: r.claimCount, returnCount: r.returnCount, rank: r.rank })),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "productId", header: "Product master ID" },
        { key: "claimCount", header: "Claim count (inclusive -- any claim touching this product)" },
        { key: "returnCount", header: "Return count (single-product claims only)" },
        { key: "rank", header: "Rank (by claim count)" },
      ]
    );

    // Item 7.
    const creditNoteCsv = buildCsv(
      report.creditNoteValue.rows.map((r) => ({ sapItemCode: r.sapItemCode, currency: r.currency, total: r.total, rank: r.rank })),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "currency", header: "Currency" },
        { key: "total", header: "Actual credit-note value (period, single-product-attributable only)" },
        { key: "rank", header: "Rank within this currency" },
      ]
    );

    // Item 8.
    const deliveryRejectionCsv = buildCsv(
      report.deliveryRejections.rows.flatMap((r) =>
        r.rejectedQuantityByUnit.length > 0
          ? r.rejectedQuantityByUnit.map((q) => ({ sapItemCode: r.sapItemCode, productId: r.productId ?? "", deliveryLinesWithRejectionCount: r.deliveryLinesWithRejectionCount, unitOfMeasure: q.unitOfMeasure, quantityTotal: q.quantityTotal, rank: r.rank }))
          : [{ sapItemCode: r.sapItemCode, productId: r.productId ?? "", deliveryLinesWithRejectionCount: r.deliveryLinesWithRejectionCount, unitOfMeasure: "", quantityTotal: "0", rank: r.rank }]
      ),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "productId", header: "Product master ID" },
        { key: "deliveryLinesWithRejectionCount", header: "Delivery lines with a recorded rejection (period)" },
        { key: "unitOfMeasure", header: "Unit of measure" },
        { key: "quantityTotal", header: "Rejected quantity total (period)" },
        { key: "rank", header: "Rank" },
      ]
    );

    // Item 9.
    const decliningActivityCsv = buildCsv(
      report.decliningActivity.rows.map((r) => ({ sapItemCode: r.sapItemCode, productId: r.productId ?? "", currency: r.currency, currentPeriodValue: r.currentPeriodValue, previousPeriodValue: r.previousPeriodValue, declineAmount: r.declineAmount, rank: r.rank })),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "productId", header: "Product master ID" },
        { key: "currency", header: "Currency" },
        { key: "currentPeriodValue", header: `${report.metricLabel} total (selected period)` },
        { key: "previousPeriodValue", header: `${report.metricLabel} total (preceding period of equal duration)` },
        { key: "declineAmount", header: "Decline amount (previous minus current)" },
        { key: "rank", header: "Rank within this currency" },
      ]
    );

    // Item 10.
    const masterDataQualityCsv = buildCsv(
      report.masterDataQuality.rows.map((r) => ({ sapItemCode: r.sapItemCode, productId: r.productId ?? "", issue: r.issue })),
      [
        { key: "sapItemCode", header: "SAP item code" },
        { key: "productId", header: "Product master ID" },
        { key: "issue", header: "Issue (unmatched = no Product master row; incomplete_category = matched but Product.category is null)" },
      ]
    );

    const summaryRows = [
      { metric: "periodFrom", value: report.periodFrom },
      { metric: "periodTo", value: report.periodTo },
      { metric: "previousPeriodFrom", value: report.previousPeriodFrom ?? "" },
      { metric: "previousPeriodTo", value: report.previousPeriodTo ?? "" },
      { metric: "productCount (items 1-4 universe)", value: String(report.revenueQuantityFrequencyCustomers.rows.length) },
      { metric: "multiProductClaimCount (excluded from item 6's returnCount and item 7)", value: String(report.claimAndReturnActivity.multiProductClaimCount) },
      { metric: "unattributableCreditNoteCount (excluded from item 7)", value: String(report.creditNoteValue.unattributableCreditNoteCount) },
      { metric: "unmatchedProductCount (item 10)", value: String(report.masterDataQuality.unmatchedCount) },
      { metric: "incompleteCategoryProductCount (item 10)", value: String(report.masterDataQuality.incompleteCategoryCount) },
    ];
    const summaryCsv = buildCsv(summaryRows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);

    const csv = [summaryCsv, revenueCsv, quantityCsv, frequencyAndCustomersCsv, lostSalesCsv, claimReturnCsv, creditNoteCsv, deliveryRejectionCsv, decliningActivityCsv, masterDataQualityCsv].join("\r\n");

    const rowCount =
      summaryRows.length +
      revenueRows.length +
      quantityRows.length +
      report.revenueQuantityFrequencyCustomers.rows.length +
      report.lostSalesActivity.rows.length +
      report.claimAndReturnActivity.rows.length +
      report.creditNoteValue.rows.length +
      report.deliveryRejections.rows.length +
      report.decliningActivity.rows.length +
      report.masterDataQuality.rows.length;

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "product-intelligence",
      filters: parsedFilters.filters,
      rowCount,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders("product-intelligence") });
  } catch (error) {
    console.error("Product intelligence export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the product intelligence overview." }, { status: 500 });
  }
}
