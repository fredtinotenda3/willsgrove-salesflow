import { describe, expect, it } from "vitest";
import { dashboardKpiToCard } from "@/lib/kpi/from-dashboard";
import type { DashboardKpi } from "@/lib/reporting/decision-dashboard";

function kpi(overrides: Partial<DashboardKpi>): DashboardKpi {
  return {
    id: "ordersReceived",
    area: "sales_orders",
    label: "Orders Received",
    value: "40",
    unit: "count",
    comparison: { kind: "period", priorValue: "30", deltaPercent: 33.3, periodLabel: "vs. previous 7 days" },
    visibility: "all",
    drillDown: { label: "View orders", href: "/orders" },
    definition: "Orders received.",
    ...overrides,
  };
}

describe("dashboardKpiToCard", () => {
  it("carries the period comparison through with the KPI's business polarity", () => {
    const card = dashboardKpiToCard(kpi({}));
    expect(card).toMatchObject({ variant: "comparison", change: 33.3, polarity: "up-good", previousValue: "30", comparisonLabel: "vs. previous 7 days", href: "/orders" });
  });
  it("marks loss-type KPIs as down-good so a rise reads as unfavourable", () => {
    const card = dashboardKpiToCard(kpi({ id: "estimatedLostSalesValue", comparison: { kind: "pointInTime", asOfLabel: "current position" } }));
    expect(card.polarity).toBe("down-good");
    expect(card.variant).toBe("default");
    expect(card.change).toBeUndefined();
  });
  it("drops the 'was' value and keeps a null change when the prior period had no data", () => {
    const card = dashboardKpiToCard(kpi({ comparison: { kind: "period", priorValue: "—", deltaPercent: null, periodLabel: "vs. previous 7 days" } }));
    expect(card.previousValue).toBeUndefined();
    expect(card.change).toBeNull();
  });
  it("defaults unknown KPIs to neutral polarity", () => {
    expect(dashboardKpiToCard(kpi({ id: "somethingNew" })).polarity).toBe("neutral");
  });
});
