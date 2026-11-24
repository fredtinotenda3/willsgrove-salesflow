import "server-only";
import { getUnifiedLostSalesReport } from "@/lib/lost-sales/unified-queries";
import { parseReportFilters } from "@/lib/reporting/filters";
import {
  MANAGEMENT_REPORT_CATALOGUE,
  getInvoiceClaimsExposureManagementReport,
  getLostSalesManagementReport,
  getOperationalSummaryReport,
  getQuotationsPerformanceReport,
  getAwaitingFulfilmentBreakdown,
  getCommunicationFailuresBreakdown,
  getDeliveryExceptionsBreakdown,
  getOutstandingOrdersBreakdown,
  getPickingShortagesBreakdown,
  listCommunicationFailures,
  listDeliveryExceptions,
  listOrdersAwaitingFulfilment,
  listOutstandingOrders,
  type ManagementReportId,
  type OperationalSummaryPeriod,
} from "@/lib/reporting/management-reports";
import type { ReportFilters } from "@/lib/reporting/types";
import {
  awaitingFulfilmentFacts,
  claimsExposureFacts,
  communicationFacts,
  deliveryExceptionFacts,
  lostSalesFacts,
  operationalFacts,
  outstandingOrderFacts,
  quotationFacts,
  shortageFacts,
} from "./facts";
import {
  buildAwaitingFulfilmentIntelligence,
  buildCommunicationFailuresIntelligence,
  buildDeliveryExceptionsIntelligence,
  buildInvoiceClaimsIntelligence,
  buildLostSalesIntelligence,
  buildOperationalSummaryIntelligence,
  buildOutstandingOrdersIntelligence,
  buildPickingShortagesIntelligence,
  buildQuotationsIntelligence,
} from "./rules";
import { sortFindings, type ManagementFinding, type ManagementIntelligence } from "./types";
import { getCommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";

/** Rows read for the age and customer rules: the report's own page maximum, oldest first. */
const RULE_PAGE = { page: 1, pageSize: 200 } as const;

export function defaultManagementFilters(): ReportFilters {
  const parsed = parseReportFilters(new URLSearchParams());
  if (!parsed.ok) throw new Error(`Default report filters failed to parse: ${parsed.message}`);
  return parsed.filters;
}

type UnifiedLoad = Awaited<ReturnType<typeof getUnifiedLostSalesReport>>;

/**
 * Lost sales and claims intelligence use the whole-business figures (all
 * dates), matching those two reports, which are themselves "right now"
 * totals. Loaded once and shared when several reports are built together.
 */
async function loadUnified(filters: ReportFilters): Promise<UnifiedLoad> {
  return getUnifiedLostSalesReport({ includeDemo: filters.includeDemo, customerId: null, dateFrom: null, dateTo: null });
}

export type IntelligenceOptions = {
  period?: OperationalSummaryPeriod;
  /** Reuse the page's own already-fetched summary data to avoid a second query. */
  summaryData?: unknown;
  unified?: UnifiedLoad;
};

export async function getReportIntelligence(reportId: ManagementReportId, filters: ReportFilters, options: IntelligenceOptions = {}): Promise<ManagementIntelligence> {
  const period = options.period ?? "monthly";
  switch (reportId) {
    case "operational-summary": {
      const data = (options.summaryData as Awaited<ReturnType<typeof getOperationalSummaryReport>> | undefined) ?? (await getOperationalSummaryReport(filters, period));
      return buildOperationalSummaryIntelligence(operationalFacts(data));
    }
    case "quotations-performance": {
      const data = (options.summaryData as Awaited<ReturnType<typeof getQuotationsPerformanceReport>> | undefined) ?? (await getQuotationsPerformanceReport(filters));
      return buildQuotationsIntelligence(quotationFacts(data));
    }
    case "lost-sales": {
      const [summary, unified] = await Promise.all([
        (options.summaryData as Awaited<ReturnType<typeof getLostSalesManagementReport>> | undefined) ?? getLostSalesManagementReport(filters),
        options.unified ?? loadUnified(filters),
      ]);
      return buildLostSalesIntelligence(lostSalesFacts({ periodLabel: "all dates", summary, unified: unified.unified, reasons: unified.reasons }));
    }
    case "invoice-claims-exposure": {
      const [financial, unified] = await Promise.all([
        (options.summaryData as Awaited<ReturnType<typeof getInvoiceClaimsExposureManagementReport>> | undefined) ?? getInvoiceClaimsExposureManagementReport(filters),
        options.unified ?? loadUnified(filters),
      ]);
      return buildInvoiceClaimsIntelligence(claimsExposureFacts({ financial, unified: unified.unified, reasons: unified.reasons }));
    }
    case "outstanding-orders": {
      const [list, breakdown] = await Promise.all([listOutstandingOrders(filters, RULE_PAGE), getOutstandingOrdersBreakdown(filters)]);
      return buildOutstandingOrdersIntelligence(outstandingOrderFacts({ rows: list.rows, totalItems: list.pagination.totalItems }, breakdown));
    }
    case "awaiting-fulfilment": {
      const [list, breakdown] = await Promise.all([listOrdersAwaitingFulfilment(filters, RULE_PAGE), getAwaitingFulfilmentBreakdown(filters)]);
      return buildAwaitingFulfilmentIntelligence(awaitingFulfilmentFacts({ rows: list.rows, totalItems: list.pagination.totalItems }, breakdown));
    }
    case "picking-shortages":
      return buildPickingShortagesIntelligence(shortageFacts(await getPickingShortagesBreakdown(filters)));
    case "delivery-exceptions": {
      const [list, breakdown] = await Promise.all([listDeliveryExceptions(filters, RULE_PAGE), getDeliveryExceptionsBreakdown(filters)]);
      return buildDeliveryExceptionsIntelligence(deliveryExceptionFacts({ rows: list.rows, totalItems: list.pagination.totalItems }, breakdown));
    }
    case "communication-failures": {
      const [list, breakdown, communications] = await Promise.all([listCommunicationFailures(filters, RULE_PAGE), getCommunicationFailuresBreakdown(filters), getCommunicationsMonitoringReport(filters)]);
      return buildCommunicationFailuresIntelligence(communicationFacts({ report: { rows: list.rows, totalItems: list.pagination.totalItems }, breakdown, communications }));
    }
  }
}

export type AggregatedFinding = ManagementFinding & { alsoRaisedIn: string[] };

export type AllIntelligence = {
  byReport: ManagementIntelligence[];
  /** One entry per topic across all reports, highest priority kept. */
  findings: AggregatedFinding[];
  insufficientEvidence: { reportId: string; notes: string[] }[];
};

/**
 * Every report's findings, built from the same data the reports themselves
 * show. The Action Centre is this aggregation, not a separate analysis.
 */
export async function getAllIntelligence(filters: ReportFilters = defaultManagementFilters()): Promise<AllIntelligence> {
  const unified = await loadUnified(filters);
  const byReport = await Promise.all(MANAGEMENT_REPORT_CATALOGUE.map((r) => getReportIntelligence(r.id, filters, { period: "monthly", unified })));

  const byTopic = new Map<string, AggregatedFinding>();
  for (const intel of byReport) {
    for (const f of intel.findings) {
      const existing = byTopic.get(f.topic);
      if (!existing) {
        byTopic.set(f.topic, { ...f, alsoRaisedIn: [] });
        continue;
      }
      const incomingBetter = sortFindings([existing, f])[0] === f && existing.priority !== f.priority;
      const keep = incomingBetter ? { ...f, alsoRaisedIn: [...existing.alsoRaisedIn, existing.reportId] } : { ...existing, alsoRaisedIn: [...existing.alsoRaisedIn, f.reportId] };
      byTopic.set(f.topic, keep);
    }
  }
  return {
    byReport,
    findings: sortFindings([...byTopic.values()]),
    insufficientEvidence: byReport.filter((i) => i.insufficientEvidence.length > 0).map((i) => ({ reportId: i.reportId, notes: i.insufficientEvidence })),
  };
}
