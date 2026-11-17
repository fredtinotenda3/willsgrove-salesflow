"use client";

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import type { LostSalesTrendPoint } from "@/lib/lost-sales/analytics-queries";

/**
 * Final completion phase, section 3 (decision-support dashboard rebuild):
 * these two trend charts were originally authored as private implementation
 * detail of app/lost-sales/analytics/page.tsx (in that route's own
 * `_components/charts.tsx`), but the new dashboard (app/page.tsx) needs the
 * exact same trend view for its "trends" section -- "reuse, never
 * re-derive" (the standing architectural rule this whole lib/reporting/
 * layer already follows) means moving the shared piece here rather than
 * copy-pasting a second implementation of the same chart. The analytics
 * page keeps importing these two from its own `_components/charts.tsx`,
 * which now simply re-exports them from here -- zero change to that
 * already-verified page's behavior or its own import path.
 *
 * Color discipline (dataviz skill): requested=--chart-1, unavailable=
 * --chart-2 everywhere those series appear, matching every other lost-sales
 * chart in this codebase ("color follows the entity, never its rank").
 */

const QUANTITY_CHART_CONFIG: ChartConfig = {
  requestedQuantity: { label: "Requested", color: "var(--chart-1)" },
  unavailableQuantity: { label: "Unavailable", color: "var(--chart-2)" },
};

const VALUE_CHART_CONFIG: ChartConfig = {
  estimatedLostValue: { label: "Estimated lost value", color: "var(--chart-1)" },
};

const AXIS_TICK_STYLE = { fontSize: 11, fill: "var(--chart-muted-ink)" };

function TrendEmptyState({ message }: { message: string }) {
  return <div className="p-10 text-center text-sm text-[#849087]">{message}</div>;
}

/** "Trend line/area" for requested vs. unavailable quantity over time -- same unit (quantity), so one shared axis. */
export function RequestedVsUnavailableTrendChart({ data }: { data: LostSalesTrendPoint[] }) {
  if (data.length === 0) return <TrendEmptyState message="No demand records in the selected range." />;
  const rows = data.map((point) => ({
    label: point.label,
    requestedQuantity: Number(point.requestedQuantity),
    unavailableQuantity: Number(point.unavailableQuantity),
  }));
  return (
    <ChartContainer config={QUANTITY_CHART_CONFIG} className="aspect-auto h-[280px] w-full">
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} width={48} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area type="monotone" dataKey="unavailableQuantity" fill="var(--color-unavailableQuantity)" stroke="var(--color-unavailableQuantity)" fillOpacity={0.18} strokeWidth={2} />
        <Line type="monotone" dataKey="requestedQuantity" stroke="var(--color-requestedQuantity)" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ChartContainer>
  );
}

/** Estimated lost value over time -- a DIFFERENT scale (currency, not quantity) from the chart above, so its own chart and its own axis rather than a second y-axis bolted onto the same one. */
export function EstimatedLostValueTrendChart({ data }: { data: LostSalesTrendPoint[] }) {
  if (data.length === 0) return <TrendEmptyState message="No demand records in the selected range." />;
  const rows = data.map((point) => ({ label: point.label, estimatedLostValue: Number(point.estimatedLostValue) }));
  return (
    <ChartContainer config={VALUE_CHART_CONFIG} className="aspect-auto h-[220px] w-full">
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK_STYLE} width={56} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area type="monotone" dataKey="estimatedLostValue" fill="var(--color-estimatedLostValue)" stroke="var(--color-estimatedLostValue)" fillOpacity={0.18} strokeWidth={2} />
      </ComposedChart>
    </ChartContainer>
  );
}
