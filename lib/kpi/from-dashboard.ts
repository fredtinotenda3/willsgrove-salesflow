import type { KpiPolarity } from "@/lib/kpi/kpi-logic";
import type { DashboardKpi } from "@/lib/reporting/decision-dashboard";

/**
 * Maps the existing decision-dashboard KPI shape onto KpiCard props, so the
 * Reports hub reuses the SAME KPIs (same definitions, same period maths) as
 * the main dashboard instead of re-deriving them. Pure -- no server-only
 * imports (the type import is erased) so it is unit-testable.
 *
 * Polarity is the business meaning of "up" for each KPI. Anything not
 * listed is neutral: a card never colours a change red/green unless the
 * direction is genuinely good or bad.
 */
export const KPI_POLARITY: Record<string, KpiPolarity> = {
  ordersReceived: "up-good",
  orderApprovalRate: "up-good",
  pickingAvailabilityRate: "up-good",
  deliveryAcceptanceRate: "up-good",
  ordersAwaitingFulfilment: "down-good",
  openInvoiceClaims: "down-good",
  claimsFinancialExposure: "down-good",
  estimatedLostSalesValue: "down-good",
  returnedGoodsLostSalesValue: "down-good",
};

export type KpiCardData = {
  title: string;
  value: string;
  variant: "default" | "comparison";
  change?: number | null;
  polarity: KpiPolarity;
  comparisonLabel?: string;
  previousValue?: string;
  description: string;
  href: string;
  hrefLabel: string;
};

export function dashboardKpiToCard(kpi: DashboardKpi): KpiCardData {
  const polarity = KPI_POLARITY[kpi.id] ?? "neutral";
  const base = {
    title: kpi.label,
    value: kpi.value,
    polarity,
    description: kpi.definition,
    href: kpi.drillDown.href,
    hrefLabel: kpi.drillDown.label,
  };
  if (kpi.comparison.kind === "period") {
    // A "—" prior value means the prior period had no data: show no "was".
    const previous = kpi.comparison.priorValue && kpi.comparison.priorValue !== "—" ? kpi.comparison.priorValue : undefined;
    return { ...base, variant: "comparison", change: kpi.comparison.deltaPercent, comparisonLabel: kpi.comparison.periodLabel, previousValue: previous };
  }
  return { ...base, variant: "default" };
}
