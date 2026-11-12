import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Milestone 11 (Operational BI). Small, shared, presentational pieces
 * used across every /reports/* page -- kept in one place so the 6 report
 * pages read consistently (spec section 12: "professional, consistent
 * enterprise feel") instead of each re-inventing its own card/badge/
 * pagination markup. No "use client": every one of these is pure
 * markup, rendered server-side.
 */

export function PageHeader({ breadcrumb, title, description, actions }: { breadcrumb: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div>
        <p className="mb-2 text-sm text-[#718078]">{breadcrumb}</p>
        <h1 className="text-2xl font-bold tracking-tight text-[#17251E] md:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-[#718078]">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function SectionCard({ title, description, icon, children, className = "" }: { title: string; description?: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm md:p-6 ${className}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-[#17251E]">{title}</h2>
          {description && <p className="mt-1 text-xs text-[#849087]">{description}</p>}
        </div>
        {icon && <div className="rounded-xl bg-[#F2F6F1] p-2.5 text-[#496A42]">{icon}</div>}
      </div>
      {children}
    </section>
  );
}

export function MetricCard({ title, value, description, dataQuality }: { title: string; value: string; description?: string; dataQuality?: "actual" | "calculated" | "provisional" | "missing" }) {
  return (
    <div className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[#718078]">{title}</p>
        {dataQuality && <DataQualityBadge quality={dataQuality} />}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-[#17251E]">{value}</p>
      {description && <p className="mt-2 text-xs text-[#849087]">{description}</p>}
    </div>
  );
}

const DATA_QUALITY_STYLES: Record<string, string> = {
  actual: "bg-emerald-50 text-emerald-700",
  calculated: "bg-cyan-50 text-cyan-700",
  provisional: "bg-amber-50 text-amber-700",
  missing: "bg-gray-100 text-gray-500",
};

const DATA_QUALITY_LABELS: Record<string, string> = {
  actual: "Actual",
  calculated: "Calculated",
  provisional: "Provisional",
  missing: "Not available",
};

/** Spec section 2: "distinguish actual recorded values from calculated, provisional, or missing data." This badge is how that distinction reaches the UI, not just the API payload. */
export function DataQualityBadge({ quality }: { quality: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${DATA_QUALITY_STYLES[quality] ?? DATA_QUALITY_STYLES.missing}`}>
      {DATA_QUALITY_LABELS[quality] ?? quality}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="p-10 text-center text-sm text-[#849087]">{message}</div>;
}

export function BarRow({ label, count, maxCount, color }: { label: string; count: number; maxCount: number; color: string }) {
  const width = `${Math.max(2, Math.round((count / Math.max(1, maxCount)) * 100))}%`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-[#536158]">{label}</span>
        <span className="font-bold tabular-nums">{count}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#F0F2EF]">
        <div className={`h-full rounded-full ${color}`} style={{ width }} />
      </div>
    </div>
  );
}

/** A rate shown alongside its own denominator/sample size, per spec section 4/5's "never show a rate without its sample size" principle, so a rate computed from one record is never mistaken for a stable trend. */
export function RateStat({ label, ratePercent, sampleSize, sampleLabel = "records" }: { label: string; ratePercent: number | null; sampleSize: number; sampleLabel?: string }) {
  return (
    <div className="rounded-xl border border-[#E9EDE8] p-4">
      <p className="text-xs font-medium text-[#849087]">{label}</p>
      <p className="mt-2 text-xl font-bold text-[#17251E]">{ratePercent === null ? "—" : `${ratePercent}%`}</p>
      <p className="mt-1 text-[11px] text-[#9AA59E]">{sampleSize === 0 ? `No ${sampleLabel} in scope` : `Based on ${sampleSize} ${sampleLabel}`}</p>
    </div>
  );
}

function buildPageHref(basePath: string, searchParams: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== "" && key !== "page") params.set(key, value);
  }
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
}

export function Pagination({
  basePath,
  searchParams,
  page,
  totalPages,
  totalItems,
  pageSize,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-[#EEF1ED] px-5 py-4 text-xs text-[#849087] sm:flex-row">
      <p>
        {totalItems === 0 ? "No records" : `Showing ${start}–${end} of ${totalItems}`}
      </p>
      <div className="flex items-center gap-2">
        <Link
          href={buildPageHref(basePath, searchParams, Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className={`rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-gray-50"}`}
        >
          Previous
        </Link>
        <span className="px-1 font-semibold text-[#17251E]">
          Page {page} of {totalPages}
        </span>
        <Link
          href={buildPageHref(basePath, searchParams, Math.min(totalPages, page + 1))}
          aria-disabled={page >= totalPages}
          className={`rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-gray-50"}`}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
