import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Inbox, ShieldAlert } from "lucide-react";

/**
 * Presentational building blocks for the administration module. Server-safe
 * (no state, no "use client"): every piece is plain markup so pages stay
 * server-rendered and the numbers shown are exactly what the query returned.
 */

export function PageHeader({ title, description, actions, back }: { title: string; description?: string; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {back ? <Link href={back.href} className="mb-1 inline-block text-xs font-medium text-[#4B6B55] hover:underline">← {back.label}</Link> : null}
        <h1 className="truncate text-xl font-semibold tracking-tight text-[#14211B] sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[#5F6F66]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ title, description, actions, children, flush = false, className = "" }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`rounded-xl border border-[#E3E8E2] bg-white shadow-[0_1px_2px_rgba(20,33,27,0.04)] ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF1ED] px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-[#14211B]">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-[#7A887F]">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad";
const TONE_TEXT: Record<Tone, string> = { neutral: "text-[#14211B]", good: "text-emerald-700", warn: "text-amber-700", bad: "text-red-700" };

/** A metric tile. When `href` is set the whole tile links to the filtered management page that produced the number. */
export function Stat({ label, value, hint, href, tone = "neutral", delta }: { label: string; value: string; hint?: string; href?: string; tone?: Tone; delta?: { pct: number | null; goodWhen: "up" | "down" } }) {
  const inner = (
    <div className={`h-full rounded-xl border border-[#E3E8E2] bg-white p-4 shadow-[0_1px_2px_rgba(20,33,27,0.04)] ${href ? "transition hover:border-[#1F7A4D]/50 hover:shadow-md" : ""}`}>
      <p className="text-xs font-medium text-[#6B7B72]">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${TONE_TEXT[tone]}`}>{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-[#7A887F]">
        {delta && delta.pct !== null ? <DeltaChip pct={delta.pct} goodWhen={delta.goodWhen} /> : null}
        {hint ? <span className="truncate">{hint}</span> : null}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D]">{inner}</Link> : inner;
}

function DeltaChip({ pct, goodWhen }: { pct: number; goodWhen: "up" | "down" }) {
  if (pct === 0) return <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">0%</span>;
  const up = pct > 0;
  const good = (goodWhen === "up") === up;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold ${good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
      {up ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
      {Math.abs(pct)}%<span className="sr-only"> {up ? "increase" : "decrease"} versus the previous period</span>
    </span>
  );
}

export function KeyValueGrid({ items, columns = 2 }: { items: { label: string; value: ReactNode }[]; columns?: 1 | 2 | 3 }) {
  const cols = columns === 1 ? "sm:grid-cols-1" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 text-sm ${cols}`}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium text-[#7A887F]">{i.label}</dt>
          <dd className="mt-0.5 break-words text-[#14211B]">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** URL-driven tabs (?tab=…): each tab is a link so a detail page is deep-linkable, server-rendered and back-button friendly. */
export function Tabs({ tabs, active, basePath, params = {} }: { tabs: { key: string; label: string; count?: number }[]; active: string; basePath: string; params?: Record<string, string | undefined> }) {
  return (
    <nav aria-label="Record sections" className="-mx-1 flex flex-wrap gap-1 border-b border-[#E3E8E2] pb-px">
      {tabs.map((t) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v && k !== "tab") q.set(k, v);
        if (t.key !== tabs[0].key) q.set("tab", t.key);
        const href = q.size ? `${basePath}?${q}` : basePath;
        const on = t.key === active;
        return (
          <Link key={t.key} href={href} scroll={false} aria-current={on ? "page" : undefined} className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition ${on ? "border-[#1F7A4D] text-[#14211B]" : "border-transparent text-[#6B7B72] hover:text-[#14211B]"}`}>
            {t.label}
            {t.count !== undefined ? <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${on ? "bg-[#E6F2EA] text-[#1F7A4D]" : "bg-slate-100 text-slate-600"}`}>{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Timeline({ items, empty = "Nothing recorded yet." }: { items: { id: string; title: ReactNode; meta?: ReactNode; body?: ReactNode }[]; empty?: string }) {
  if (items.length === 0) return <EmptyState message={empty} compact />;
  return (
    <ol className="relative space-y-4 border-l border-[#E3E8E2] pl-5">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-[#1F7A4D] ring-4 ring-white" aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className="font-medium text-[#14211B]">{i.title}</span>{i.meta ? <span className="text-xs text-[#7A887F]">{i.meta}</span> : null}</div>
          {i.body ? <div className="mt-0.5 text-xs text-[#5F6F66]">{i.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({ message, title, action, compact = false }: { message: string; title?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-12"}`}>
      <div className="mb-2 rounded-full bg-[#F1F4F0] p-2.5 text-[#7A887F]"><Inbox size={compact ? 16 : 20} aria-hidden /></div>
      {title ? <p className="text-sm font-semibold text-[#14211B]">{title}</p> : null}
      <p className="mt-0.5 max-w-sm text-sm text-[#7A887F]">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger"; title?: string; children: ReactNode }) {
  const style = tone === "danger" ? "border-red-200 bg-red-50 text-red-800" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900";
  const Icon = tone === "danger" ? ShieldAlert : tone === "warn" ? AlertTriangle : Info;
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${style}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">{title ? <p className="font-semibold">{title}</p> : null}<div className={title ? "mt-0.5" : ""}>{children}</div></div>
    </div>
  );
}

/** Small muted link used for "open in operational view" style cross-references. */
export function ExternalLinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const cls = variant === "primary" ? "bg-[#1F7A4D] text-white hover:bg-[#186540]" : "border border-[#D5DCD4] bg-white text-[#14211B] hover:bg-[#F1F4F0]";
  return <Link href={href} className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold ${cls}`}>{children}</Link>;
}

export function LoadingBlock({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-9 rounded-md bg-[#EEF1ED]" />)}
    </div>
  );
}
