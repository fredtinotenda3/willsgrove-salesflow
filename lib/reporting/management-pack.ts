import "server-only";
import { getDecisionDashboard, type DashboardKpi } from "@/lib/reporting/decision-dashboard";
import { getSalesRevenueReport } from "@/lib/reporting/sales-revenue-queries";
import { getClaimComposition } from "@/lib/invoice-claims/composition-queries";
import { CLAIM_LINE_REASON_CATEGORY_LABELS } from "@/lib/invoice-claims/validation";
import { KPI_POLARITY } from "@/lib/kpi/from-dashboard";
import { parseReportFilters } from "@/lib/reporting/filters";
import { percentChange } from "@/lib/format/analytics";
import type { ReportFilters } from "@/lib/reporting/types";
import type { PackPeriod } from "@/lib/reporting/management-pack-period";
import type { ManagementPack, PackKpi } from "@/lib/reporting/management-pack-types";

/**
 * Assembles the weekly/monthly management pack from EXISTING reports:
 *   - KPIs and exceptions  -> getDecisionDashboard (run once per period, so
 *     the comparison is the true previous calendar week/month rather than
 *     the dashboard's "previous N days" window);
 *   - invoiced revenue      -> getSalesRevenueReport (per currency);
 *   - unresolved claims     -> getClaimComposition (non-terminal claims).
 * Callers MUST have passed requireManagementReportAccess(): this composes
 * revenue and claim-exposure money, which is manager-only everywhere else.
 */

function baseFilters(): ReportFilters {
  const parsed = parseReportFilters(new URLSearchParams());
  if (!parsed.ok) throw new Error(`Default report filters failed to parse: ${parsed.message}`);
  return parsed.filters;
}

function numeric(value: string): number | null {
  if (!/^-?[\d,]*\.?\d+%?$/.test(value.trim())) return null;
  const n = Number(value.replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toPackKpi(current: DashboardKpi, prior: DashboardKpi | undefined): PackKpi {
  const priorValue = prior && prior.value !== "—" ? prior.value : null;
  const comparable = current.unit === "count" || current.unit === "percent";
  const a = numeric(current.value);
  const b = priorValue ? numeric(priorValue) : null;
  return {
    id: current.id,
    label: current.label,
    unit: current.unit,
    value: current.value,
    previousValue: priorValue,
    changePercent: comparable ? percentChange(a, b) : null,
    polarity: KPI_POLARITY[current.id] ?? "neutral",
    definition: current.definition,
  };
}

/** KPIs that describe a point-in-time position rather than the period, so a "previous period" value would be misleading. */
const POINT_IN_TIME_KPI_IDS = new Set(["ordersAwaitingFulfilment", "openInvoiceClaims", "claimsFinancialExposure"]);

export async function getManagementPack(viewerId: string, viewerRole: string, period: PackPeriod): Promise<ManagementPack> {
  const base = baseFilters();
  const currentFilters: ReportFilters = { ...base, dateFrom: period.dateFrom, dateTo: period.dateTo };
  const priorFilters: ReportFilters = { ...base, dateFrom: period.prior.dateFrom, dateTo: period.prior.dateTo };

  const [current, prior, revenueNow, revenuePrior, unresolved] = await Promise.all([
    getDecisionDashboard(viewerId, viewerRole, currentFilters),
    getDecisionDashboard(viewerId, viewerRole, priorFilters),
    getSalesRevenueReport(currentFilters),
    getSalesRevenueReport(priorFilters),
    getClaimComposition({ unresolvedOnly: true, topProducts: 8 }),
  ]);

  const priorKpiById = new Map(prior.kpis.map((kpi) => [kpi.id, kpi]));
  const kpis = current.kpis.map((kpi) => toPackKpi(kpi, POINT_IN_TIME_KPI_IDS.has(kpi.id) ? undefined : priorKpiById.get(kpi.id)));

  const priorRevenueByCurrency = new Map(revenuePrior.byCurrency.map((r) => [r.currency, r]));
  const revenue = revenueNow.byCurrency.map((row) => {
    const before = priorRevenueByCurrency.get(row.currency);
    return {
      currency: row.currency,
      value: row.totalLineValue,
      previousValue: before ? before.totalLineValue : null,
      changePercent: before ? percentChange(Number(row.totalLineValue), Number(before.totalLineValue)) : null,
      excludedLineCount: row.excludedLineCount,
    };
  });

  const reasonLabels = CLAIM_LINE_REASON_CATEGORY_LABELS as Record<string, string>;
  const notes = [
    "Invoiced revenue is the sum of SAP invoice line values for invoices dated in the period, per currency. Currencies are never added together.",
    "Lost-sales value carries no currency in the source data and is shown in USD, the currency of the price lists it is estimated from.",
    "Unresolved claims, open orders awaiting fulfilment and the exceptions list are positions as at the time this pack was generated, not limited to the period.",
    "A claim is a customer dispute, not a SAP credit note. Unresolved claim exposure is the disputed value at invoice prices; credit notes recorded in SAP are reported separately.",
    "Comparisons are against the immediately preceding calendar week or month. Where a figure for the previous period does not exist, no change is shown.",
  ];
  if (!period.isComplete) notes.unshift("This period has not finished yet: every period figure is to date.");
  if (unresolved.truncated) notes.push("Claim figures are based on the first 20,000 claim lines only.");

  return {
    period: {
      kind: period.kind,
      label: period.label,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      isComplete: period.isComplete,
      priorLabel: period.prior.label,
      priorDateFrom: period.prior.dateFrom,
      priorDateTo: period.prior.dateTo,
    },
    generatedAt: new Date().toISOString(),
    kpis,
    revenue,
    unresolvedClaims: {
      claimLineCount: unresolved.summary.claimLineCount,
      exposure: unresolved.summary.valueByCurrency,
      linesWithoutPrice: unresolved.summary.valueIncompleteLines,
      topReasons: unresolved.summary.byReason.slice(0, 6).map((r) => ({
        reason: r.reasonCategory ? reasonLabels[r.reasonCategory] ?? r.reasonCategory : "No reason recorded",
        claimLineCount: r.claimLineCount,
        value: r.valueByCurrency,
      })),
      topProducts: unresolved.rows.map((r) => ({
        name: r.description ?? r.sapItemCode ?? "(unnamed product)",
        unit: r.unit,
        delivered: r.delivered,
        deliveredComplete: r.deliveredComplete,
        accepted: r.accepted,
        rejected: r.rejected,
        returned: r.returned,
        value: r.valueByCurrency,
      })),
    },
    repeatedShortages: current.repeatedProductShortages.map((p) => ({ name: p.name, sapItemCode: p.sapItemCode, demandCount: p.demandCount, unavailableQuantity: p.unavailableQuantity, unit: p.unitOfMeasure })),
    exceptions: current.exceptions.filter((e) => e.count > 0).map((e) => ({ label: e.label, count: e.count, severity: e.severity })),
    notes,
  };
}
