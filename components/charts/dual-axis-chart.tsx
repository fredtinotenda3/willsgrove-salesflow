"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatCompactMoney, formatMoney, formatQuantity } from "@/lib/format/analytics";

/**
 * Reusable dual-axis ("composed") chart: quantities on the LEFT axis,
 * money on the RIGHT axis, so two different units are never drawn on one
 * scale. Bars carry the quantity series; the money series are drawn as
 * lines (time axes) or as diamond markers only (category axes such as
 * products, where a connecting line would imply a trend between unrelated
 * items).
 *
 * Design rules baked in:
 *   - Each axis is titled with its unit; money is formatted with the
 *     currency symbol ("$"), never as a bare number.
 *   - The legend doubles as series toggles (real <button aria-pressed>,
 *     keyboard accessible) -- hiding a series never rescales the other
 *     axis incorrectly because each axis only reads its own series.
 *   - The tooltip is compact, opaque and never scrolls: a header, then
 *     only the plotted series. Anything richer belongs in a drilldown
 *     table, not a hover card.
 *   - Colour follows the entity (requested/found/unavailable keep the same
 *     hues as every other lost-sales chart); a quantity series and its
 *     money counterpart share a hue, the money one dashed.
 *
 * Pure presentation: callers pass already-aggregated rows from a server
 * service. Nothing is fetched or computed here beyond number coercion.
 */

export type DualAxisRow = Record<string, string | number | null | undefined>;

export type DualAxisSeries = {
  key: string;
  label: string;
  /** CSS colour, normally a --chart-* token. */
  color: string;
};

export type DualAxisChartProps = {
  data: DualAxisRow[];
  /** Field holding the x-axis category / date label. */
  xKey: string;
  /** Optional field holding the row's unit of measure, appended to quantity values in the tooltip. */
  unitKey?: string;
  quantitySeries: DualAxisSeries[];
  valueSeries: DualAxisSeries[];
  /** "line": connect money points (time series). "markers": diamonds only (categories). */
  valueMode: "line" | "markers";
  currency?: string;
  quantityAxisTitle?: string;
  valueAxisTitle?: string;
  height?: number;
  emptyMessage?: string;
  /** Short caption rendered under the chart (e.g. a unit caveat). */
  footnote?: ReactNode;
  ariaLabel: string;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function DiamondMarker(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx, cy, fill } = props;
  if (cx === undefined || cy === undefined || Number.isNaN(cx) || Number.isNaN(cy)) return null;
  const r = 5;
  return <path d={`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`} fill={fill} stroke="var(--popover)" strokeWidth={1} />;
}

type TooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: readonly { payload?: unknown }[];
};

function CompactTooltip({
  active,
  payload,
  label,
  props,
  hidden,
}: TooltipProps & { props: DualAxisChartProps; hidden: Set<string> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as DualAxisRow | undefined;
  if (!row) return null;
  const unit = props.unitKey ? (row[props.unitKey] as string | null | undefined) ?? null : null;
  const quantities = props.quantitySeries.filter((s) => !hidden.has(s.key));
  const values = props.valueSeries.filter((s) => !hidden.has(s.key));

  return (
    <div className="relative z-50 w-[240px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 truncate font-semibold">{String(label ?? row[props.xKey] ?? "")}</p>
      {quantities.map((s) => (
        <TooltipRow key={s.key} color={s.color} label={s.label} value={formatQuantity(num(row[s.key]), unit)} />
      ))}
      {quantities.length > 0 && values.length > 0 && <div className="my-1 border-t border-border/60" />}
      {values.map((s) => (
        <TooltipRow key={s.key} color={s.color} label={s.label} value={formatMoney(num(row[s.key]), props.currency)} dashed />
      ))}
    </div>
  );
}

function TooltipRow({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0"
          style={dashed ? { background: color, transform: "rotate(45deg)" } : { background: color, borderRadius: 2 }}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function DualAxisChart(props: DualAxisChartProps) {
  const {
    data,
    xKey,
    quantitySeries,
    valueSeries,
    valueMode,
    currency = "USD",
    quantityAxisTitle = "Quantity",
    valueAxisTitle,
    height = 340,
    emptyMessage = "No data in the selected range.",
    footnote,
    ariaLabel,
  } = props;

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const rows = useMemo(
    () =>
      data.map((row) => {
        const next: DualAxisRow = { ...row };
        for (const s of [...quantitySeries, ...valueSeries]) next[s.key] = num(row[s.key]);
        return next;
      }),
    [data, quantitySeries, valueSeries]
  );

  const config = useMemo<ChartConfig>(() => {
    const c: ChartConfig = {};
    for (const s of [...quantitySeries, ...valueSeries]) c[s.key] = { label: s.label, color: s.color };
    return c;
  }, [quantitySeries, valueSeries]);

  if (rows.length === 0) {
    return <div className="p-10 text-center text-sm text-[#849087]">{emptyMessage}</div>;
  }

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const tick = { fontSize: 11, fill: "var(--chart-muted-ink)" };

  return (
    <figure aria-label={ariaLabel} className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Show or hide series">
        {[...quantitySeries.map((s) => ({ s, kind: "qty" as const })), ...valueSeries.map((s) => ({ s, kind: "val" as const }))].map(({ s, kind }) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173D2E] ${off ? "border-gray-200 bg-gray-50 text-gray-400" : "border-[#E1E7E2] bg-white text-[#17251E]"}`}
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5"
                style={kind === "qty" ? { background: off ? "#d1d5db" : s.color, borderRadius: 2 } : { background: off ? "#d1d5db" : s.color, transform: "rotate(45deg)" }}
              />
              <span className={off ? "line-through" : ""}>{s.label}</span>
            </button>
          );
        })}
      </div>

      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} tick={tick} interval="preserveStartEnd" minTickGap={12} />
          <YAxis
            yAxisId="qty"
            orientation="left"
            tickLine={false}
            axisLine={false}
            tick={tick}
            width={52}
            tickFormatter={(v: number) => formatQuantity(v, null, 1)}
            label={{ value: quantityAxisTitle, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "var(--chart-muted-ink)", textAnchor: "middle" } }}
          />
          <YAxis
            yAxisId="val"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={tick}
            width={60}
            tickFormatter={(v: number) => formatCompactMoney(v, currency)}
            label={{ value: valueAxisTitle ?? `Value (${currency})`, angle: 90, position: "insideRight", style: { fontSize: 11, fill: "var(--chart-muted-ink)", textAnchor: "middle" } }}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            wrapperStyle={{ zIndex: 50, outline: "none" }}
            content={(tp: TooltipProps) => <CompactTooltip {...tp} props={props} hidden={hidden} />}
          />
          {quantitySeries.map((s) => (
            <Bar key={s.key} yAxisId="qty" dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={22} hide={hidden.has(s.key)} isAnimationActive={false} />
          ))}
          {valueSeries.map((s) => (
            <Line
              key={s.key}
              yAxisId="val"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={valueMode === "line" ? 2 : 0}
              strokeDasharray={valueMode === "line" ? "5 3" : undefined}
              connectNulls={false}
              dot={valueMode === "markers" ? <DiamondMarker fill={s.color} /> : { r: 3, fill: s.color, stroke: "var(--popover)" }}
              activeDot={valueMode === "markers" ? <DiamondMarker fill={s.color} /> : { r: 5 }}
              hide={hidden.has(s.key)}
              isAnimationActive={false}
              type="monotone"
            />
          ))}
        </ComposedChart>
      </ChartContainer>
      {footnote && <figcaption className="mt-2 text-[11px] text-[#849087]">{footnote}</figcaption>}
    </figure>
  );
}
