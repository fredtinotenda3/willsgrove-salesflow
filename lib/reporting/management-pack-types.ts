/**
 * Weekly / monthly management pack: the data shape shared by the page, the
 * print layout and the Excel export, so all three show identical figures.
 * Pure types only (no runtime imports).
 *
 * Every figure is reused from an existing report; the pack computes nothing
 * new except a percentage change between two figures it was handed. A
 * figure that cannot be known is `null`, never a guess.
 */
export type PackKpi = {
  id: string;
  label: string;
  unit: "count" | "percent" | "currency" | "days";
  value: string;
  previousValue: string | null;
  /** Percent change, only for count/percent units where both periods are numeric; null otherwise (currency KPIs are shown side by side, not as a computed change). */
  changePercent: number | null;
  /** Business meaning of "up", so the page can colour a change correctly. */
  polarity: "up-good" | "down-good" | "neutral";
  definition: string;
};

export type PackRevenueRow = {
  currency: string;
  value: string;
  previousValue: string | null;
  changePercent: number | null;
  /** Invoice lines left out of the figure (no line total). */
  excludedLineCount: number;
};

export type PackMoneyRow = { currency: string; value: string };

export type PackShortageRow = { name: string; sapItemCode: string | null; demandCount: number; unavailableQuantity: string; unit: string | null };

export type PackExceptionRow = { label: string; count: number; severity: "info" | "attention" | "urgent" };

export type PackReasonRow = { reason: string; claimLineCount: number; value: PackMoneyRow[] };

export type PackRejectedProductRow = {
  name: string;
  unit: string | null;
  delivered: string;
  deliveredComplete: boolean;
  accepted: string;
  rejected: string;
  returned: string;
  value: PackMoneyRow[];
};

export type ManagementPack = {
  period: { kind: "week" | "month"; label: string; dateFrom: string; dateTo: string; isComplete: boolean; priorLabel: string; priorDateFrom: string; priorDateTo: string };
  generatedAt: string;
  kpis: PackKpi[];
  revenue: PackRevenueRow[];
  /** "As at generation time", NOT filtered to the period: an unresolved claim is unresolved today regardless of when it was raised. */
  unresolvedClaims: {
    claimLineCount: number;
    exposure: PackMoneyRow[];
    linesWithoutPrice: number;
    topReasons: PackReasonRow[];
    topProducts: PackRejectedProductRow[];
  };
  repeatedShortages: PackShortageRow[];
  exceptions: PackExceptionRow[];
  /** Plain-language caveats printed with the pack so nobody reads a figure more strongly than it deserves. */
  notes: string[];
};
