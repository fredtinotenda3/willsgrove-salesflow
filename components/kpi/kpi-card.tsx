import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { KpiSparkline } from "@/components/kpi/kpi-sparkline";
import {
  KPI_STATUS_LABELS,
  deltaDirection,
  deltaTone,
  describeDelta,
  statusFromThresholds,
  targetProgress,
  type KpiPolarity,
  type KpiStatus,
  type KpiThresholds,
} from "@/lib/kpi/kpi-logic";

/**
 * KPI card system.
 *
 * One small shell (`KpiCard`) composed from independent, optional parts --
 * delta, sparkline, target bar, status badge, comparison line, forecast --
 * so a card only shows what it has REAL data for. Nothing is defaulted:
 * no previous value means no delta, fewer than three points means no
 * sparkline, no target means no progress bar, no thresholds means no
 * status. A card with only `title` + `value` is a perfectly good card.
 *
 * Variants are presets for which parts are expected; they never force a
 * part to appear:
 *   default    value (+ description)
 *   trend      value + delta + sparkline
 *   target     value + progress toward a target
 *   status     value + Healthy / Warning / Critical badge
 *   comparison value + previous-period value and delta
 *   forecast   value + projected value (caller supplies it ONLY when it is
 *              computed from real data; this component never extrapolates)
 *
 * States: ready | loading | empty | unavailable | error.
 *
 * Values arrive PRE-FORMATTED (use lib/format/analytics) so currency,
 * quantity and percentage formatting is decided once, by the caller, and a
 * per-currency figure is never blended here.
 *
 * Accessibility: the whole card is one link when `href` is set (visible
 * focus ring); change direction is never conveyed by colour alone (arrow
 * icon + sr-only sentence); the target bar is a real progressbar.
 */

export type KpiVariant = "default" | "trend" | "target" | "status" | "comparison" | "forecast";
export type KpiState = "ready" | "loading" | "empty" | "unavailable" | "error";

export type KpiCardProps = {
  title: string;
  variant?: KpiVariant;
  state?: KpiState;
  /** Display-ready primary metric. Required when state is "ready". */
  value?: string | null;
  /** One-line definition / context under the value. */
  description?: string;

  /** Percentage change vs the comparison period. Omit/null when there is no reliable baseline. */
  change?: number | null;
  /** Which direction is good for the business. Drives green/red, independent of arrow direction. */
  polarity?: KpiPolarity;
  /** e.g. "vs previous 7 days". */
  comparisonLabel?: string;
  /** Previous-period value, display-ready (comparison variant). */
  previousValue?: string | null;

  sparkline?: ReadonlyArray<number | null | undefined>;

  target?: { actual: number; target: number; format?: (n: number) => string; label?: string };

  status?: KpiStatus | null;
  /** Alternative to `status`: derive it from the raw number with explicit thresholds. */
  statusValue?: number | null;
  thresholds?: KpiThresholds;

  forecast?: { value: string; label: string };

  /** ISO string or Date -- when the figure was computed. */
  asOf?: string | Date | null;
  href?: string;
  hrefLabel?: string;
  /** Shown instead of the generic text for unavailable / error / empty states. */
  stateMessage?: string;
  className?: string;
};

const STATUS_STYLES: Record<KpiStatus, string> = {
  healthy: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  critical: "bg-red-50 text-red-700 ring-red-200",
};

const TONE_STYLES = {
  favourable: "text-emerald-700",
  unfavourable: "text-red-700",
  neutral: "text-gray-500",
} as const;

function formatAsOf(asOf: string | Date | null | undefined): string | null {
  if (!asOf) return null;
  const date = typeof asOf === "string" ? new Date(asOf) : asOf;
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function KpiDelta({ change, polarity = "neutral", comparisonLabel }: { change: number | null | undefined; polarity?: KpiPolarity; comparisonLabel?: string }) {
  const direction = deltaDirection(change);
  const tone = deltaTone(change, polarity);
  if (direction === null || tone === null || change === null || change === undefined) return null;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <p className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${TONE_STYLES[tone]}`}>
      <Icon size={14} aria-hidden="true" />
      <span aria-hidden="true">{direction === "flat" ? "0.0%" : `${Math.abs(change).toFixed(1)}%`}</span>
      {comparisonLabel && (
        <span aria-hidden="true" className="font-normal text-gray-400">
          {comparisonLabel}
        </span>
      )}
      <span className="sr-only">{describeDelta(change, polarity, comparisonLabel)}</span>
    </p>
  );
}

export function KpiStatusBadge({ status }: { status: KpiStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {KPI_STATUS_LABELS[status]}
    </span>
  );
}

export function KpiTargetBar({ actual, target, format = (n: number) => n.toLocaleString("en-US"), label = "Target" }: { actual: number; target: number; format?: (n: number) => string; label?: string }) {
  const progress = targetProgress(actual, target);
  if (!progress) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {label}: {format(target)}
        </span>
        <span className="font-semibold tabular-nums text-[#17251E]">{progress.percent.toFixed(0)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.barPercent)}
        className="h-1.5 overflow-hidden rounded-full bg-[#EEF1ED]"
      >
        <div className={`h-full rounded-full ${progress.reached ? "bg-emerald-600" : "bg-[#315C43]"}`} style={{ width: `${progress.barPercent}%` }} />
      </div>
    </div>
  );
}

function CardShell({ href, hrefLabel, title, className, children }: { href?: string; hrefLabel?: string; title: string; className?: string; children: ReactNode }) {
  const base = `group relative block rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm ${className ?? ""}`;
  if (!href) return <div className={base}>{children}</div>;
  return (
    <Link
      href={href}
      aria-label={hrefLabel ? `${title} — ${hrefLabel}` : title}
      className={`${base} transition hover:border-[#C9D4C6] hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173D2E]`}
    >
      {children}
    </Link>
  );
}

export function KpiCard(props: KpiCardProps) {
  const {
    title,
    variant = "default",
    state = "ready",
    value,
    description,
    change,
    polarity = "neutral",
    comparisonLabel,
    previousValue,
    sparkline,
    target,
    status,
    statusValue,
    thresholds,
    forecast,
    asOf,
    href,
    hrefLabel,
    stateMessage,
    className,
  } = props;

  const header = (
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm font-medium text-[#718078]">{title}</p>
      {href && <ArrowRight size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />}
    </div>
  );

  if (state === "loading") {
    return (
      <CardShell title={title} className={className}>
        <div aria-busy="true" aria-live="polite">
          {header}
          <div className="mt-3 h-7 w-28 animate-pulse rounded bg-gray-100" />
          <div className="mt-3 h-3 w-40 animate-pulse rounded bg-gray-100" />
          <span className="sr-only">Loading {title}</span>
        </div>
      </CardShell>
    );
  }

  if (state === "error" || state === "unavailable" || state === "empty" || value === null || value === undefined) {
    const effective: KpiState = state === "ready" ? "unavailable" : state;
    const text =
      stateMessage ??
      (effective === "error" ? "Could not load this figure." : effective === "empty" ? "No data in this period." : "Not available yet — the underlying data does not exist for this scope.");
    return (
      <CardShell title={title} href={href} hrefLabel={hrefLabel} className={className}>
        {header}
        <p className="mt-3 text-2xl font-bold tracking-tight text-gray-300" aria-hidden="true">—</p>
        <p role={effective === "error" ? "alert" : undefined} className={`mt-2 flex items-start gap-1.5 text-xs ${effective === "error" ? "text-red-600" : "text-[#849087]"}`}>
          {effective === "error" && <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {text}
        </p>
      </CardShell>
    );
  }

  const derivedStatus = status ?? statusFromThresholds(statusValue, thresholds);
  const showDelta = variant === "trend" || variant === "comparison" || change !== undefined;
  const asOfText = formatAsOf(asOf);

  return (
    <CardShell title={title} href={href} hrefLabel={hrefLabel} className={className}>
      {header}
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-2xl font-bold tracking-tight tabular-nums text-[#17251E]">{value}</p>
        {(variant === "status" || derivedStatus) && derivedStatus ? <KpiStatusBadge status={derivedStatus} /> : null}
      </div>

      {showDelta && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3">
          <KpiDelta change={change} polarity={polarity} comparisonLabel={comparisonLabel} />
          {previousValue && (variant === "comparison" || change !== undefined) && <span className="text-[11px] text-gray-400">was {previousValue}</span>}
        </div>
      )}

      {sparkline && (variant === "trend" || variant === "default") && (
        <div className="mt-2">
          <KpiSparkline points={sparkline} />
        </div>
      )}

      {target && <KpiTargetBar actual={target.actual} target={target.target} format={target.format} label={target.label} />}

      {forecast && (
        <p className="mt-2 text-[11px] text-gray-500">
          <span className="font-semibold text-[#17251E]">{forecast.value}</span> {forecast.label}
        </p>
      )}

      {description && <p className="mt-2 text-xs text-[#849087]">{description}</p>}
      {asOfText && <p className="mt-2 text-[10px] text-gray-400">Updated {asOfText}</p>}
    </CardShell>
  );
}
