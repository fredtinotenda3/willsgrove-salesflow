import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters } from "@/lib/reporting/filters";
import { listAllDecisionRecommendationsForExport } from "@/lib/reporting/decision-intelligence-queries";
import { buildCsv, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 15 (Decision Intelligence). CSV export for the
 * recommendation list (spec section 9). Exports every row matching the
 * current filters (not just one page), preserving filters/currency/
 * evidence/priority/status and excluding sensitive internal data (no
 * raw evidence JSON blob -- only the same headline metrics and source-
 * record labels the UI itself shows). Management-only.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const rows = await listAllDecisionRecommendationsForExport(parsed.filters);
    const csvRows = rows.map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      decisionCategory: r.decisionCategory,
      priority: r.priority,
      confidence: r.confidence,
      title: r.title,
      explanation: r.explanation,
      recommendedNextAction: r.recommendedNextAction,
      customerName: r.customerName ?? "",
      productSapItemCode: r.sapItemCode ?? "",
      salespersonName: r.salespersonName ?? "",
      currencyCode: r.currencyCode ?? "",
      reportingPeriodFrom: r.reportingPeriodFrom,
      reportingPeriodTo: r.reportingPeriodTo,
      status: r.status,
      statusNote: r.statusNote ?? "",
      firstDetectedAt: r.firstDetectedAt,
      lastEvaluatedAt: r.lastEvaluatedAt,
    }));

    const csv = buildCsv(csvRows, [
      { key: "id", header: "Recommendation ID" },
      { key: "ruleId", header: "Rule" },
      { key: "decisionCategory", header: "Category" },
      { key: "priority", header: "Priority" },
      { key: "confidence", header: "Confidence" },
      { key: "title", header: "Title" },
      { key: "explanation", header: "Explanation" },
      { key: "recommendedNextAction", header: "Recommended next action" },
      { key: "customerName", header: "Customer" },
      { key: "productSapItemCode", header: "Product (SAP item code)" },
      { key: "salespersonName", header: "Salesperson" },
      { key: "currencyCode", header: "Currency" },
      { key: "reportingPeriodFrom", header: "Period from" },
      { key: "reportingPeriodTo", header: "Period to" },
      { key: "status", header: "Status" },
      { key: "statusNote", header: "Status note" },
      { key: "firstDetectedAt", header: "First detected" },
      { key: "lastEvaluatedAt", header: "Last evaluated" },
    ]);

    await recordReportExport({ actorId: auth.user.id, reportId: "decision-intelligence-recommendations", filters: parsed.filters, rowCount: csvRows.length });

    return new NextResponse(csv, { headers: csvResponseHeaders("decision-intelligence-recommendations") });
  } catch (error) {
    console.error("Decision intelligence export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export recommendations." }, { status: 500 });
  }
}
