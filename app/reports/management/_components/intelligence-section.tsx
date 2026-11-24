import Link from "next/link";
import { ACTION_STATUS_LABELS } from "@/lib/management-intelligence/action-state";
import type { TrackedAction } from "@/lib/management-intelligence/actions";
import { THRESHOLD_DESCRIPTIONS } from "@/lib/management-intelligence/thresholds";
import { PRIORITY_LABELS, RESPONSIBLE_FUNCTION_LABELS, type FindingPriority, type ManagementFinding, type ManagementIntelligence } from "@/lib/management-intelligence/types";
import { actionKey } from "@/lib/management-intelligence/action-state";
import { SectionCard } from "../../_components/ui";
import { ActionControls } from "./action-controls";

export const PRIORITY_BADGE: Record<FindingPriority, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-[#F4F6F4] text-[#52605A]",
};

type Assignee = { id: string; name: string; role: string };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#718078]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[#17251E]">{children}</dd>
    </div>
  );
}

export function FindingCard({ finding, tracked, assignees, reportName }: { finding: ManagementFinding; tracked: TrackedAction | undefined; assignees: Assignee[]; reportName?: string }) {
  return (
    <article className="rounded-xl border border-[#E7ECE7] bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-[#17251E]">{finding.title}</h3>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span className={`rounded-full px-2.5 py-1 ${PRIORITY_BADGE[finding.priority]}`}>{PRIORITY_LABELS[finding.priority]}</span>
          <span className="rounded-full bg-[#F4F6F4] px-2.5 py-1 text-[#52605A]">{RESPONSIBLE_FUNCTION_LABELS[finding.responsibleFunction]}</span>
          <span className="rounded-full bg-[#F4F6F4] px-2.5 py-1 text-[#52605A]">{finding.timeframe}</span>
        </div>
      </header>
      {reportName && <p className="mt-1 text-[11px] text-[#718078]">From: {reportName}</p>}
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        <Field label="Finding">{finding.finding}</Field>
        <Field label="Business impact">{finding.businessImpact}</Field>
        <Field label="Recommended action">{finding.recommendedAction}</Field>
        <Field label="Expected outcome">{finding.expectedOutcome}</Field>
        <Field label="Evidence">
          <ul className="space-y-0.5 text-xs">
            {finding.evidence.map((e) => (
              <li key={`${e.label}:${e.value}`}>
                <span className="text-[#718078]">{e.label}:</span> <span className="font-semibold tabular-nums">{e.value}</span>
              </li>
            ))}
          </ul>
        </Field>
        <Field label="How success is measured">{finding.measurement}</Field>
      </dl>
      {finding.links.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-3 text-xs">
          {finding.links.map((l) => (
            <Link key={l.href + l.label} href={l.href} className="font-semibold text-[#2F6B4F] underline">
              {l.label}
            </Link>
          ))}
        </p>
      )}
      <ActionControls
        reportId={finding.reportId}
        findingKey={finding.key}
        status={tracked?.status ?? "OPEN"}
        assignedToId={tracked?.assignedToId ?? null}
        assignedToName={tracked?.assignedToName ?? null}
        statusNote={tracked?.statusNote ?? null}
        assignees={assignees}
      />
    </article>
  );
}

/**
 * "Management intelligence" for one report: what the data shows, what to do
 * about it and who should do it. Every figure comes from the report's own
 * data; where the data is too thin the section says so instead of advising.
 */
export function IntelligenceSection({ intelligence, tracked, assignees }: { intelligence: ManagementIntelligence; tracked: TrackedAction[]; assignees: Assignee[] }) {
  const byKey = new Map(tracked.map((t) => [t.findingKey, t]));
  return (
    <SectionCard title="Management intelligence" description="What this report's data shows, what to do about it, who should do it and how to tell it worked. Computed from the figures on this page, not stored.">
      {intelligence.findings.length === 0 && intelligence.insufficientEvidence.length === 0 && (
        <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{intelligence.noActionIndicated ? "No action indicated: the figures are within the rule parameters below." : "Nothing to report for this view."}</p>
      )}
      {intelligence.findings.length > 0 && (
        <div className="space-y-4">
          {intelligence.findings.map((f) => (
            <FindingCard key={f.key} finding={f} tracked={byKey.get(actionKey(f.reportId, f.key))} assignees={assignees} />
          ))}
        </div>
      )}
      {intelligence.insufficientEvidence.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Insufficient evidence</p>
          <p className="mt-1 text-xs text-amber-900">No recommendation is made on these points because the data is too thin to support one.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
            {intelligence.insufficientEvidence.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="mt-4 text-xs text-[#52605A]">
        <summary className="cursor-pointer font-semibold">Rule parameters used (flags for review, not targets)</summary>
        <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
          {THRESHOLD_DESCRIPTIONS.map((t) => (
            <li key={t.label}>
              {t.label}: <span className="font-semibold">{t.value}</span>
            </li>
          ))}
        </ul>
      </details>
    </SectionCard>
  );
}

export function statusLabel(status: TrackedAction["status"]): string {
  return ACTION_STATUS_LABELS[status];
}
