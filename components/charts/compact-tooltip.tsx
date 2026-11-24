"use client";

import type { ReactNode } from "react";

/**
 * Compact chart tooltip shell + row. Opaque (bg-popover is solid), above
 * neighbouring content (z-50), fixed narrow width, NEVER scrolls -- a
 * tooltip that needs scrolling is a drilldown table in disguise. Callers
 * decide which few figures matter and pre-format them (lib/format/
 * analytics), so currency always carries its symbol and a quantity always
 * its unit.
 */
export function CompactTooltipShell({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative z-50 w-[240px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
      {title && <p className="mb-1.5 truncate font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function CompactTooltipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {color && <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
