"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { ProductBarTooltipContent, CustomerBarTooltipContent } from "@/components/charts/rich-tooltip";
import { EmptyState } from "../../../reports/_components/ui";
import type {
  LostSalesProductBreakdown,
  LostSalesCustomerBreakdown,
  LostSalesCompositionBreakdown,
  LostSalesDistribution,
} from "@/lib/lost-sales/analytics-queries";

/**
 * Final completion phase, section 3: the two time-series trend charts
 * (requested-vs-unavailable quantity, estimated lost value) that used to
 * live in this file are now shared with the new decision-support
 * dashboard (app/page.tsx) and have moved to
 * components/charts/lost-sales-trend.tsx -- re-exported here so this
 * page's own import (`from "./_components/charts"`) and every other
 * export below it are completely unaffected.
 */
export { RequestedVsUnavailableTrendChart, EstimatedLostValueTrendChart } from "@/components/charts/lost-sales-trend";

/**
 * Additional Implementation Requirements (spec section 3: "Lost Sales
 * Analytics Overhaul", spec sections 11-12: shadcn chart components /
 * data-visualization quality standard). The charts island for
 * app/lost-sales/analytics/page.tsx -- a Client Component (Recharts
 * needs the DOM) fed pre-aggregated data computed server-side by
 * lib/lost-sales/analytics-queries.ts, never raw rows. No chart here
 * fetches anything itself.
 *
 * Color discipline (dataviz skill, loaded for this work): categorical
 * hues are assigned ONCE per entity below and reused identically across
 * every chart that plots that entity ("color follows the entity, never
 * its rank") -- requested=--chart-1, found=--chart-3, unavailable=
 * --chart-2 everywhere those three appear; a chart with only one series
 * gets no legend box (the SectionCard title already names it), and every
 * chart ships the default hover tooltip. One axis per chart throughout --
 * a quantity trend and a currency trend are two separate charts, never
 * one dual-axis chart, per the skill's own non-negotiable.
 */

const QUANTITY_CHART_CONFIG: ChartConfig = {
  requestedQuantity: { label: "Requested", color: "var(--chart-1)" },
  foundQuantity: { label: "Found", color: "var(--chart-3)" },
  unavailableQuantity: { label: "Unavailable", color: "var(--chart-2)" },
};

const SINGLE_UNAVAILABLE_CONFIG: ChartConfig = {
  unavailableQuantity: { label: "Unavailable quantity", color: "var(--chart-2)" },
};

const SHORTAGE_RATE_CONFIG: ChartConfig = {
  shortageRatePercent: { label: "Shortage rate", color: "var(--chart-2)" },
};

const HISTOGRAM_CONFIG: ChartConfig = {
  count: { label: "Demands", color: "var(--chart-1)" },
};

const AXIS_TICK_STYLE = { fontSize: 11, fill: "var(--chart-muted-ink)" };

// Chart intelligence enhancement: matches components/charts/lost-sales-trend.tsx's
// own DEFAULT_BASE_PATH/DEFAULT_BASE_QUERY exactly -- every chart's drill-down
// defaults to this same page with no extra filter, so a caller that doesn't
// pass these (none do yet outside page.tsx, which passes its own current
// filters) still gets a working, if unfiltered, drill-down link.
const DEFAULT_BASE_PATH = "/lost-sales/analytics";
const DEFAULT_BASE_QUERY: Record<string, string> = {};

function truncateLabel(label: string, max = 22): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

type EntityBreakdownRow = LostSalesProductBreakdown | LostSalesCustomerBreakdown;

function isProductBreakdown(row: EntityBreakdownRow): row is LostSalesProductBreakdown {
  return "productDescriptionSnapshot" in row;
}

function entityLabelOf(row: EntityBreakdownRow): string {
  return isProductBreakdown(row) ? row.productDescriptionSnapshot : row.customerName;
}

/**
 * Shared rich-tooltip picker for the per-product/per-customer bar charts
 * below -- the SAME aggregate shape (LostSalesProductBreakdown /
 * LostSalesCustomerBreakdown) backs both products and customers, so one
 * switch here, not two charts each re-deciding it.
 */
function entityTooltip(kind: "product" | "customer", basePath: string, baseQuery: Record<string, string>) {
  return kind === "product" ? (
    <ProductBarTooltipContent basePath={basePath} baseQuery={baseQuery} />
  ) : (
    <CustomerBarTooltipContent basePath={basePath} baseQuery={baseQuery} />
  );
}

/**
 * Spec: top-N unavailable products/customers -- a single series
 * (unavailable quantity), so no legend box; horizontal bars read long
 * product/customer names better than a vertical layout would at N=10.
 *
 * Chart intelligence enhancement: `rows` is now the FULL per-entity
 * breakdown (not a flattened {label, unavailableQuantity} pair), so each
 * bar's own tooltip shows the complete picture spec sections 2-4 ask for
 * -- requested/found/unavailable, estimated vs. confirmed value,
 * affected orders/customers -- plus a drill-down link into this same
 * page's own filters/drilldown table. `unavailableQuantityNum` is added
 * (not overwritten in place) purely for Recharts' own numeric `dataKey`;
 * the original `unavailableQuantity` STRING field the tooltip formats
 * stays untouched on the same row object.
 */
export function TopUnavailableBarChart({
  rows,
  entityLabel,
  kind,
  basePath = DEFAULT_BASE_PATH,
  baseQuery = DEFAULT_BASE_QUERY,
}: {
  rows: EntityBreakdownRow[];
  entityLabel: string;
  kind: "product" | "customer";
  basePath?: string;
  baseQuery?: Record<string, string>;
}) {
  if (rows.length === 0) return <EmptyState message={`No ${entityLabel} shortages in the selected range.`} />;
  const data = rows.map((row) => ({
    ...row,
    displayLabel: truncateLabel(entityLabelOf(row)),
    unavailableQuantityNum: Number(row.unavailableQuantity),
  }));
  return (
    <ChartContainer config={SINGLE_UNAVAILABLE_CONFIG} className="aspect-auto h-[320px] w-full">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} />
        <YAxis dataKey="displayLabel" type="category" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} width={140} />
        <ChartTooltip content={entityTooltip(kind, basePath, baseQuery)} />
        <Bar dataKey="unavailableQuantityNum" fill="var(--color-unavailableQuantity)" radius={4} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Spec: "requested vs found vs unavailable, grouped bars" -- three series
 * (fixed categorical colors, reused from the trend chart above), so a
 * legend is required.
 *
 * Chart intelligence enhancement: each bar's own tooltip now shows this
 * product's full breakdown (value split, affected orders/customers,
 * drill-down link), not just the three plotted numbers. Unlike
 * TopUnavailableBarChart above, the three plotted fields here are
 * overwritten IN PLACE with their numeric form (not added under new
 * names) -- components/ui/chart.tsx's ChartLegendContent looks up each
 * series' label by `config[dataKey]`, so the dataKey must stay exactly
 * `requestedQuantity`/`foundQuantity`/`unavailableQuantity` to match
 * QUANTITY_CHART_CONFIG's own keys, or the legend renders with no text.
 * Same pattern components/charts/lost-sales-trend.tsx's trend chart
 * already uses for the identical reason. ProductBarTooltipContent's own
 * formatQty/formatPlainAmount coerce via Number.parseFloat either way,
 * so the tooltip still renders correctly off this now-numeric field.
 */
export function RequestedFoundUnavailableChart({
  data,
  basePath = DEFAULT_BASE_PATH,
  baseQuery = DEFAULT_BASE_QUERY,
}: {
  data: LostSalesProductBreakdown[];
  basePath?: string;
  baseQuery?: Record<string, string>;
}) {
  if (data.length === 0) return <EmptyState message="No product shortages in the selected range." />;
  const rows = data.map((row) => ({
    ...row,
    displayLabel: truncateLabel(row.productDescriptionSnapshot),
    requestedQuantity: Number(row.requestedQuantity),
    foundQuantity: Number(row.foundQuantity),
    unavailableQuantity: Number(row.unavailableQuantity),
  }));
  return (
    <ChartContainer config={QUANTITY_CHART_CONFIG} className="aspect-auto h-[360px] w-full">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} />
        <YAxis dataKey="displayLabel" type="category" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} width={140} />
        <ChartTooltip content={<ProductBarTooltipContent basePath={basePath} baseQuery={baseQuery} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="requestedQuantity" fill="var(--color-requestedQuantity)" radius={3} maxBarSize={14} />
        <Bar dataKey="foundQuantity" fill="var(--color-foundQuantity)" radius={3} maxBarSize={14} />
        <Bar dataKey="unavailableQuantity" fill="var(--color-unavailableQuantity)" radius={3} maxBarSize={14} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Spec: shortage rate ranking by product/customer -- single series (a
 * percentage), gated upstream by MIN_DEMAND_COUNT_FOR_RATE_RANKING so a
 * 100%-on-one-record entry never appears here (spec's "avoid misleading
 * analytics").
 *
 * Chart intelligence enhancement: `rows` is now the full per-entity
 * breakdown (analytics-queries.ts's shortageRateByProduct/
 * shortageRateByCustomer return the same rich shape every other
 * product/customer chart on this page uses), so this ranking gets the
 * identical rich tooltip -- not a bare label+rate pair.
 * `shortageRatePercentNum` coalesces the breakdown's own nullable rate to
 * 0 purely for Recharts' numeric dataKey; a null can't reach this chart
 * in practice (analytics-queries.ts's rankByShortageRate already filters
 * out null-rate aggregates before this array is built), but the
 * coalesce keeps the Bar's type contract honest without re-asserting
 * that invariant here.
 */
export function ShortageRateBarChart({
  rows,
  entityLabel,
  kind,
  basePath = DEFAULT_BASE_PATH,
  baseQuery = DEFAULT_BASE_QUERY,
}: {
  rows: EntityBreakdownRow[];
  entityLabel: string;
  kind: "product" | "customer";
  basePath?: string;
  baseQuery?: Record<string, string>;
}) {
  if (rows.length === 0) {
    return <EmptyState message={`Not enough repeat demand per ${entityLabel} yet to rank a reliable shortage rate.`} />;
  }
  const data = rows.map((row) => ({
    ...row,
    displayLabel: truncateLabel(entityLabelOf(row)),
    shortageRatePercentNum: row.shortageRatePercent ?? 0,
  }));
  return (
    <ChartContainer config={SHORTAGE_RATE_CONFIG} className="aspect-auto h-[320px] w-full">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} unit="%" />
        <YAxis dataKey="displayLabel" type="category" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} width={140} />
        <ChartTooltip content={entityTooltip(kind, basePath, baseQuery)} />
        <Bar dataKey="shortageRatePercentNum" fill="var(--color-shortageRatePercent)" radius={4} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}

const COMPOSITION_SEGMENTS: { key: keyof LostSalesCompositionBreakdown; label: string; color: string }[] = [
  { key: "outstandingQuantity", label: "Outstanding (awaiting supply)", color: "var(--chart-4)" },
  { key: "cancelledNotConfirmedLostQuantity", label: "Cancelled, not confirmed lost", color: "var(--chart-7)" },
  { key: "confirmedLostQuantity", label: "Confirmed lost", color: "var(--chart-8)" },
  { key: "substitutedQuantity", label: "Substituted", color: "var(--chart-6)" },
  { key: "undecidedQuantity", label: "Undecided / unclassified", color: "var(--chart-5)" },
];

/**
 * Spec: "composition stacked bar" -- a single, tall segmented bar with
 * direct value+percentage labels on every segment (the dataviz skill's
 * one named exception to "never label every point": the tall segmented
 * bar keeps its legend too, since segment order carries no rank to key
 * color off of).
 */
export function CompositionStackedBar({ composition }: { composition: LostSalesCompositionBreakdown }) {
  const total = Number(composition.totalUnavailableQuantity);
  if (total <= 0) return <EmptyState message="No unavailable quantity in the selected range." />;

  return (
    <div className="space-y-3">
      <div className="flex h-8 w-full overflow-hidden rounded-lg border border-[#E7ECE7]">
        {COMPOSITION_SEGMENTS.map((segment) => {
          const value = Number(composition[segment.key]);
          const widthPercent = total > 0 ? (value / total) * 100 : 0;
          if (widthPercent <= 0) return null;
          return (
            <div
              key={segment.key}
              className="h-full"
              style={{ width: `${widthPercent}%`, backgroundColor: segment.color }}
              title={`${segment.label}: ${value.toFixed(2)} (${widthPercent.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {COMPOSITION_SEGMENTS.map((segment) => {
          const value = Number(composition[segment.key]);
          const widthPercent = total > 0 ? (value / total) * 100 : 0;
          return (
            <div key={segment.key} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: segment.color }} />
              <dt className="flex-1 text-[#536158]">{segment.label}</dt>
              <dd className="font-semibold tabular-nums text-[#17251E]">
                {value.toFixed(2)} ({widthPercent.toFixed(1)}%)
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/**
 * Spec: "histograms/box plots/percentiles where sample size is
 * sufficient." Below lib/lost-sales/analytics-validation.ts's
 * MIN_SAMPLE_SIZE_FOR_DISTRIBUTION, both are null and this renders the
 * "insufficient sample" message instead of a misleading chart drawn from
 * too little data (spec's own warning).
 */
export function UnavailableQuantityDistribution({ distribution }: { distribution: LostSalesDistribution }) {
  if (!distribution.sufficientForDistribution || !distribution.histogram || !distribution.percentiles) {
    return (
      <EmptyState
        message={`Only ${distribution.sampleSize} demand record${distribution.sampleSize === 1 ? "" : "s"} in the selected range -- a percentile or histogram needs a larger sample to be meaningful, so none is shown.`}
      />
    );
  }

  const histogramRows = distribution.histogram.map((bucket) => ({
    rangeLabel: `${bucket.bucketStart.toFixed(1)}–${bucket.bucketEnd.toFixed(1)}`,
    count: bucket.count,
  }));
  const { p25, p50, p75, p90 } = distribution.percentiles;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PercentileTile label="p25" value={p25} />
        <PercentileTile label="p50 (median)" value={p50} />
        <PercentileTile label="p75" value={p75} />
        <PercentileTile label="p90" value={p90} />
      </div>
      <ChartContainer config={HISTOGRAM_CONFIG} className="aspect-auto h-[220px] w-full">
        <BarChart data={histogramRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="rangeLabel" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} width={36} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent labelKey="rangeLabel" />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={3} maxBarSize={32} />
        </BarChart>
      </ChartContainer>
      <p className="text-[11px] text-[#9AA59E]">Based on {distribution.sampleSize} demand records&apos; unavailable quantity.</p>
    </div>
  );
}

function PercentileTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#E9EDE8] p-3 text-center">
      <p className="text-[11px] font-medium text-[#849087]">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-[#17251E]">{value.toFixed(2)}</p>
    </div>
  );
}
