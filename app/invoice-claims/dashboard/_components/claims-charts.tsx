"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { CompactTooltipRow, CompactTooltipShell } from "@/components/charts/compact-tooltip";
import { formatCompactMoney, formatMoney, formatQuantity } from "@/lib/format/analytics";

/**
 * Claims dashboard charts. Client islands fed pre-aggregated rows from
 * lib/invoice-claims (composition + dashboard). Colour follows the entity:
 * delivered = neutral grey-green, accepted = aqua, rejected = orange,
 * returned = violet -- the same hues on every claims chart.
 *
 * A claim is NOT a SAP credit note: these charts show what was DISPUTED.
 * Actual credited amounts appear only in the "credited" series of the
 * exposure chart, taken from recorded credit notes.
 */

const TICK = { fontSize: 11, fill: "var(--chart-muted-ink)" };

function truncate(label: string, max = 20): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function num(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function Empty({ message }: { message: string }) {
  return <div className="p-10 text-center text-sm text-[#849087]">{message}</div>;
}

type TipProps = { active?: boolean; payload?: readonly { payload?: unknown }[] };

// ---------------------------------------------------------------------------

export type CompositionChartRow = {
  label: string;
  unit: string | null;
  delivered: string;
  deliveredComplete: boolean;
  accepted: string;
  rejected: string;
  returned: string;
  value: string | null;
  currency: string | null;
  reason: string | null;
};

const COMPOSITION_CONFIG: ChartConfig = {
  delivered: { label: "Delivered", color: "var(--chart-muted-ink)" },
  accepted: { label: "Accepted", color: "var(--chart-3)" },
  rejected: { label: "Rejected", color: "var(--chart-2)" },
  returned: { label: "Returned", color: "var(--chart-7)" },
};

/** Delivered / accepted / rejected / returned quantity per rejected product -- each product in its own unit, never summed across products. */
export function ClaimCompositionChart({ rows }: { rows: CompositionChartRow[] }) {
  if (rows.length === 0) return <Empty message="No claim lines yet." />;
  const data = rows.map((r) => ({
    ...r,
    name: truncate(r.label),
    deliveredN: num(r.delivered),
    acceptedN: num(r.accepted),
    rejectedN: num(r.rejected),
    returnedN: num(r.returned),
  }));
  const height = Math.max(240, data.length * 56 + 40);
  return (
    <ChartContainer config={COMPOSITION_CONFIG} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barGap={2}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" tickLine={false} axisLine={false} tick={TICK} tickFormatter={(v: number) => formatQuantity(v, null, 1)} />
        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={TICK} width={130} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          wrapperStyle={{ zIndex: 50, outline: "none" }}
          content={({ active, payload }: TipProps) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as (typeof data)[number] | undefined;
            if (!r) return null;
            return (
              <CompactTooltipShell title={r.label}>
                <CompactTooltipRow color="var(--chart-muted-ink)" label="Delivered" value={r.deliveredComplete ? formatQuantity(r.delivered, r.unit) : `${formatQuantity(r.delivered, r.unit)}*`} />
                <CompactTooltipRow color="var(--chart-3)" label="Accepted" value={formatQuantity(r.accepted, r.unit)} />
                <CompactTooltipRow color="var(--chart-2)" label="Rejected" value={formatQuantity(r.rejected, r.unit)} />
                <CompactTooltipRow color="var(--chart-7)" label="Returned" value={formatQuantity(r.returned, r.unit)} />
                {r.value && <CompactTooltipRow label="Claim value" value={formatMoney(r.value, r.currency)} />}
                {r.reason && <CompactTooltipRow label="Main reason" value={r.reason} />}
                {!r.deliveredComplete && <p className="mt-1 text-[10px] text-muted-foreground">*Some claim lines have no linked invoice line, so delivered is understated.</p>}
              </CompactTooltipShell>
            );
          }}
        />
        <Bar dataKey="deliveredN" name="Delivered" fill="var(--color-delivered)" radius={3} maxBarSize={10} isAnimationActive={false} />
        <Bar dataKey="acceptedN" name="Accepted" fill="var(--color-accepted)" radius={3} maxBarSize={10} isAnimationActive={false} />
        <Bar dataKey="rejectedN" name="Rejected" fill="var(--color-rejected)" radius={3} maxBarSize={10} isAnimationActive={false} />
        <Bar dataKey="returnedN" name="Returned" fill="var(--color-returned)" radius={3} maxBarSize={10} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------

export type ExposureChartRow = { currency: string; potential: string; approved: string; credited: string };

const EXPOSURE_CONFIG: ChartConfig = {
  potential: { label: "Potential (claimed)", color: "var(--chart-2)" },
  approved: { label: "Approved", color: "var(--chart-1)" },
  credited: { label: "Credited by SAP", color: "var(--chart-3)" },
};

/** Claimed vs approved vs actually-credited amount, for ONE currency (callers render one chart per currency so currencies are never blended). */
export function ClaimExposureChart({ row }: { row: ExposureChartRow }) {
  const data = [
    { name: "Potential (claimed)", key: "potential", amount: num(row.potential), fill: "var(--color-potential)" },
    { name: "Approved", key: "approved", amount: num(row.approved), fill: "var(--color-approved)" },
    { name: "Credited by SAP", key: "credited", amount: num(row.credited), fill: "var(--color-credited)" },
  ];
  return (
    <ChartContainer config={EXPOSURE_CONFIG} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} tick={TICK} />
        <YAxis tickLine={false} axisLine={false} tick={TICK} width={56} tickFormatter={(v: number) => formatCompactMoney(v, row.currency)} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          wrapperStyle={{ zIndex: 50, outline: "none" }}
          content={({ active, payload }: TipProps) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number] | undefined;
            if (!d) return null;
            return (
              <CompactTooltipShell title={d.name}>
                <CompactTooltipRow label={`Amount (${row.currency})`} value={formatMoney(d.amount, row.currency)} />
              </CompactTooltipShell>
            );
          }}
        />
        {/* per-bar colours come from the `fill` on each datum above */}
        <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
