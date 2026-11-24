"use client";

import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { CompactTooltipRow, CompactTooltipShell } from "@/components/charts/compact-tooltip";
import { formatCompactMoney, formatMoney, formatQuantity } from "@/lib/format/analytics";

/**
 * Charts for claims by STANDARDISED reason. Fed pre-aggregated rows from
 * lib/lost-sales/unified-core.ts (the one shared calculation), so the
 * Invoice Claims dashboard and Lost Sales Analytics always agree. Reason
 * labels are the real standardised reasons; nothing here invents a list.
 * One chart per currency / per unit: currencies and units are never summed.
 */

const TICK = { fontSize: 11, fill: "var(--chart-muted-ink)" };
const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)", "var(--chart-muted-ink)"];

function truncate(label: string, max = 24): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
function num(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}
function Empty({ message }: { message: string }) {
  return <div className="p-10 text-center text-sm text-[#849087]">{message}</div>;
}
type TipProps = { active?: boolean; payload?: readonly { payload?: unknown }[] };

export type ReasonChartRow = { reasonCategory: string; label: string; claimCount: number; claimSharePercent: number | null; claimLineCount: number };

/** 1. Claims by reason, ranked, with count and % of total claims. */
export function ClaimsByReasonChart({ rows, totalClaims }: { rows: ReasonChartRow[]; totalClaims: number }) {
  if (rows.length === 0) return <Empty message="No claims with a standardised reason in this period." />;
  const data = rows.map((r) => ({ ...r, name: truncate(r.label), pct: r.claimSharePercent ?? 0 }));
  const config: ChartConfig = { claimCount: { label: "Claims", color: "var(--chart-2)" } };
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(220, data.length * 44 + 30) }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} />
        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={TICK} width={150} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          wrapperStyle={{ zIndex: 50, outline: "none" }}
          content={({ active, payload }: TipProps) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as (typeof data)[number] | undefined;
            if (!r) return null;
            return (
              <CompactTooltipShell title={r.label}>
                <CompactTooltipRow color="var(--chart-2)" label="Claims" value={String(r.claimCount)} />
                <CompactTooltipRow label="Share of all claims" value={r.claimSharePercent === null ? "—" : `${r.claimSharePercent.toFixed(1)}%`} />
                <CompactTooltipRow label="Claim lines" value={String(r.claimLineCount)} />
                <p className="mt-1 text-[10px] text-muted-foreground">Of {totalClaims} claim(s). A claim with several reasons counts under each.</p>
              </CompactTooltipShell>
            );
          }}
        />
        <Bar dataKey="claimCount" fill="var(--color-claimCount)" radius={4} maxBarSize={22} isAnimationActive={false} label={{ position: "right", fontSize: 11, fill: "var(--chart-muted-ink)", formatter: (v: unknown) => String(v) }} />
      </BarChart>
    </ChartContainer>
  );
}

export type ExposureRow = { label: string; value: string };

/** 2. Disputed value by reason for ONE currency. */
export function ExposureByReasonChart({ rows, currency }: { rows: ExposureRow[]; currency: string }) {
  if (rows.length === 0) return <Empty message={`No ${currency} disputed value in this period.`} />;
  const data = rows.map((r) => ({ name: truncate(r.label), label: r.label, amount: num(r.value), raw: r.value }));
  const config: ChartConfig = { amount: { label: `Disputed value (${currency})`, color: "var(--chart-1)" } };
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(200, data.length * 40 + 40) }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" tickLine={false} axisLine={false} tick={TICK} tickFormatter={(v: number) => formatCompactMoney(v, currency)} />
        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={TICK} width={150} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          wrapperStyle={{ zIndex: 50, outline: "none" }}
          content={({ active, payload }: TipProps) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number] | undefined;
            if (!d) return null;
            return (
              <CompactTooltipShell title={d.label}>
                <CompactTooltipRow color="var(--chart-1)" label={`Disputed (${currency})`} value={formatMoney(d.raw, currency)} />
                <p className="mt-1 text-[10px] text-muted-foreground">At invoice prices. A dispute, not a credit note.</p>
              </CompactTooltipShell>
            );
          }}
        />
        <Bar dataKey="amount" fill="var(--color-amount)" radius={4} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export type QuantityRow = { label: string; rejected: string; returned: string };

/** 3. Rejected vs physically returned quantity by reason, for ONE unit. */
export function QuantityByReasonChart({ rows, unit }: { rows: QuantityRow[]; unit: string | null }) {
  if (rows.length === 0) return <Empty message="No rejected quantity in this period." />;
  const data = rows.map((r) => ({ name: truncate(r.label), label: r.label, rejected: num(r.rejected), returned: num(r.returned) }));
  const config: ChartConfig = { rejected: { label: "Rejected", color: "var(--chart-2)" }, returned: { label: "Physically returned", color: "var(--chart-7)" } };
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(220, data.length * 56 + 60) }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barGap={2}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" tickLine={false} axisLine={false} tick={TICK} />
        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={TICK} width={150} />
        <Legend verticalAlign="top" height={24} iconType="square" wrapperStyle={{ fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          wrapperStyle={{ zIndex: 50, outline: "none" }}
          content={({ active, payload }: TipProps) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number] | undefined;
            if (!d) return null;
            return (
              <CompactTooltipShell title={d.label}>
                <CompactTooltipRow color="var(--chart-2)" label="Rejected" value={formatQuantity(d.rejected, unit)} />
                <CompactTooltipRow color="var(--chart-7)" label="Physically returned" value={formatQuantity(d.returned, unit)} />
                <p className="mt-1 text-[10px] text-muted-foreground">Rejected goods are not necessarily returned.</p>
              </CompactTooltipShell>
            );
          }}
        />
        <Bar dataKey="rejected" name="Rejected" fill="var(--color-rejected)" radius={3} maxBarSize={12} isAnimationActive={false} />
        <Bar dataKey="returned" name="Physically returned" fill="var(--color-returned)" radius={3} maxBarSize={12} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export type TrendChartData = { granularity: "day" | "week" | "month"; buckets: { key: string; label: string; counts: Record<string, number> }[]; reasons: { reasonCategory: string; label: string }[] };

/** 4. Claims by reason over time (stacked, distinct claims per bucket, by claim date). */
export function ReasonTrendChart({ trend }: { trend: TrendChartData }) {
  const hasData = trend.buckets.some((b) => Object.values(b.counts).some((n) => n > 0));
  if (!hasData) return <Empty message="No claims in this period to trend." />;
  const config: ChartConfig = Object.fromEntries(trend.reasons.map((r, i) => [r.reasonCategory, { label: r.label, color: PALETTE[i % PALETTE.length] }]));
  const data = trend.buckets.map((b) => ({ key: b.key, label: b.label, ...b.counts }));
  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} tick={TICK} interval="preserveStartEnd" minTickGap={16} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} width={32} />
        <Legend verticalAlign="top" height={40} iconType="square" wrapperStyle={{ fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          wrapperStyle={{ zIndex: 50, outline: "none" }}
          content={({ active, payload }: TipProps) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as Record<string, unknown> | undefined;
            if (!d) return null;
            const present = trend.reasons.map((r, i) => ({ r, i, n: Number(d[r.reasonCategory] ?? 0) })).filter((x) => x.n > 0);
            const unit = trend.granularity === "day" ? "Day" : trend.granularity === "week" ? "Week starting" : "Month";
            return (
              <CompactTooltipShell title={`${unit} ${String(d.label)}`}>
                {present.length === 0 ? <p className="text-muted-foreground">No claims</p> : present.map(({ r, i, n }) => <CompactTooltipRow key={r.reasonCategory} color={PALETTE[i % PALETTE.length]} label={r.label} value={String(n)} />)}
              </CompactTooltipShell>
            );
          }}
        />
        {trend.reasons.map((r) => (
          <Bar key={r.reasonCategory} dataKey={r.reasonCategory} name={r.label} stackId="reasons" fill={`var(--color-${r.reasonCategory})`} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
