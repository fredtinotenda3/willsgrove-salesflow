"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { usableSparkline } from "@/lib/kpi/kpi-logic";

/**
 * Mini trend line for a KPI card. Decorative-but-honest: renders nothing
 * unless there are at least three REAL points (see usableSparkline), is
 * hidden from assistive tech (the delta text carries the meaning) and has
 * no tooltip -- exact values live in the full report it drills into.
 */
export function KpiSparkline({ points, color = "var(--chart-1)", label }: { points: ReadonlyArray<number | null | undefined> | undefined; color?: string; label?: string }) {
  const data = usableSparkline(points);
  if (!data) return null;
  const rows = data.map((value, index) => ({ index, value }));
  return (
    <div className="h-8 w-full" aria-hidden="true" data-testid="kpi-sparkline" title={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
