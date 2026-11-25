import Link from "next/link";
import { getCommandCentre } from "@/lib/admin/command-centre";
import { fmtDate, fmtDateTime, fmtInt, fmtMoney, humanize, pctChange } from "@/lib/admin/format";
import { PRESETS } from "@/lib/admin/list-query";
import { firstParam as one } from "@/lib/admin/paging";
import { EmptyState, Notice, PageHeader, Panel, Stat } from "./_components/ui";
import { requireAdminPage } from "./_components/admin-shell";

export const instant = false;

/** Command centre. Every figure links to the filtered list that produced it, and the activity cards compare with the equally long previous period. */
export default async function AdminCommandCentrePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const c = await getCommandCentre(one(raw.range));
  const span = `${fmtDate(c.window.gte)} – ${fmtDate(new Date(c.window.lt.getTime() - 1))}`;
  const act = (label: string, m: { value: number; previous: number | null; href: string }, goodWhen: "up" | "down" = "up") => (
    <Stat label={label} value={fmtInt(m.value)} href={m.href} hint={`prev. ${fmtInt(m.previous ?? 0)}`} delta={{ pct: pctChange(m.value, m.previous ?? 0), goodWhen }} />
  );
  const queue = (label: string, m: { value: number; href: string }, tone: "neutral" | "warn" = "neutral") => <Stat label={label} value={fmtInt(m.value)} href={m.href} tone={m.value > 0 ? tone : "neutral"} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Command centre" description="The live position of orders, quotations, finance and integrations. Click any figure to open the records behind it."
        actions={<div className="flex flex-wrap gap-1 rounded-lg border border-[#DDE3DC] bg-white p-1" role="group" aria-label="Date range">{PRESETS.map((p) => <Link key={p.key} href={`/admin?range=${p.key}`} aria-current={p.key === c.preset ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${p.key === c.preset ? "bg-[#17251E] text-white" : "text-[#5E6B63] hover:bg-[#F1F4F0]"}`}>{p.label}</Link>)}</div>} />

      <Panel title="Needs attention" description="Work that has no owner, has gone quiet, or has failed. Each line opens the matching list.">
        {c.attention.length === 0 ? <EmptyState compact message="Nothing needs administrator attention right now." /> : (
          <ul className="divide-y divide-[#EEF1ED]">
            {c.attention.map((a) => (
              <li key={a.text}><Link href={a.href} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-[#F7F8F6]">
                <span className="flex items-center gap-2"><span className={`inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-xs font-bold ${a.tone === "danger" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{fmtInt(a.count)}</span>{a.text}</span>
                <span className="shrink-0 text-xs font-semibold text-[#1F7A4D]">Open →</span>
              </Link></li>
            ))}
          </ul>
        )}
      </Panel>

      <section aria-label="Activity" className="space-y-2">
        <h2 className="text-sm font-semibold text-[#14211B]">Activity <span className="font-normal text-[#7A887F]">· {span} vs the previous {c.preset === "mtd" || c.preset === "ytd" ? "equal-length period" : "period"}</span></h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {act("Orders created", c.activity.ordersCreated)}{act("Quotations created", c.activity.quotationsCreated)}{act("Claims raised", c.activity.claimsRaised, "down")}{act("SAP invoices imported", c.activity.invoicesImported)}
        </div>
      </section>

      <section aria-label="Open queues" className="space-y-2">
        <h2 className="text-sm font-semibold text-[#14211B]">Open queues <span className="font-normal text-[#7A887F]">· as of now</span></h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {queue("Open orders", c.queues.openOrders)}{queue("Awaiting approval", c.queues.awaitingApproval, "warn")}{queue("Open quotations", c.queues.openQuotations)}{queue("Open claims", c.queues.openClaims)}{queue("Pending approvals", c.queues.pendingApprovals, "warn")}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Value by currency" description="USD and ZWG are never combined. Orders exclude cancelled; quotations exclude cancelled and superseded revisions.">
          {c.money.ordersByCurrency.length === 0 && c.money.quotedByCurrency.length === 0 ? <EmptyState compact message="No orders or quotations in this period." /> : (
            <table className="w-full text-sm"><thead className="text-left text-xs text-[#7A887F]"><tr><th className="px-4 py-2 font-medium">Currency</th><th className="px-4 py-2 text-right font-medium">Orders</th><th className="px-4 py-2 text-right font-medium">Order value</th><th className="px-4 py-2 text-right font-medium">Quoted</th></tr></thead>
              <tbody>{Array.from(new Set([...c.money.ordersByCurrency.map((r) => r.currency), ...c.money.quotedByCurrency.map((r) => r.currency)])).sort().map((cur) => {
                const o = c.money.ordersByCurrency.find((r) => r.currency === cur); const q = c.money.quotedByCurrency.find((r) => r.currency === cur);
                return <tr key={cur} className="border-t border-[#EEF1ED]"><td className="px-4 py-2 font-semibold">{cur}</td><td className="px-4 py-2 text-right tabular-nums">{o?.count ?? 0}</td><td className="px-4 py-2 text-right tabular-nums">{fmtMoney(cur, o?.total ?? 0)}</td><td className="px-4 py-2 text-right tabular-nums">{fmtMoney(cur, q?.total ?? 0)}</td></tr>;
              })}</tbody></table>
          )}
        </Panel>
        <Panel title="Open claim exposure" description="Calculated by the same routine as the claims dashboard." actions={<Link href="/invoice-claims/dashboard" className="text-xs font-semibold text-[#1F7A4D]">Claims dashboard →</Link>}>
          {c.money.claimExposure.length === 0 ? <EmptyState compact message="No open claims carry financial exposure." /> : (
            <table className="w-full text-sm"><thead className="text-left text-xs text-[#7A887F]"><tr><th className="px-4 py-2 font-medium">Currency</th><th className="px-4 py-2 text-right font-medium">Potential</th><th className="px-4 py-2 text-right font-medium">Approved</th><th className="px-4 py-2 text-right font-medium">Credited in SAP</th></tr></thead>
              <tbody>{c.money.claimExposure.map((e) => <tr key={e.currencyCode} className="border-t border-[#EEF1ED]"><td className="px-4 py-2 font-semibold">{e.currencyCode}</td><td className="px-4 py-2 text-right tabular-nums">{fmtMoney(e.currencyCode, e.potentialCreditExposure)}</td><td className="px-4 py-2 text-right tabular-nums">{fmtMoney(e.currencyCode, e.approvedCreditExposure)}</td><td className="px-4 py-2 text-right tabular-nums">{fmtMoney(e.currencyCode, e.actualSapCreditedAmount)}</td></tr>)}</tbody></table>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="System health" actions={<Link href="/admin/integrations" className="text-xs font-semibold text-[#1F7A4D]">SAP integration →</Link>}>
          <div className="space-y-2 p-4 text-sm">
            <p>{c.system.integrations.lastSuccessfulSync?.completedAt ? <>Last successful SAP sync: <strong>{humanize(c.system.integrations.lastSuccessfulSync.jobType)}</strong> on {fmtDateTime(c.system.integrations.lastSuccessfulSync.completedAt)}.</> : "No successful SAP sync is recorded yet."}</p>
            <p className="text-[#5E6B63]">{fmtInt(c.system.activeUsers)} active users, {c.system.administrators} administrator(s).</p>
            {c.system.integrations.failedJobs + c.system.integrations.failedOps + c.system.integrations.uncertainOps > 0 ? <Notice tone="warn">{c.system.integrations.failedJobs} sync job(s) failed or partial, {c.system.integrations.failedOps} operation(s) failed, {c.system.integrations.uncertainOps} uncertain — an uncertain operation must be reconciled with SAP before any retry.</Notice> : <p className="text-emerald-700">No failed or uncertain SAP work.</p>}
          </div>
        </Panel>
        <Panel title="Recent administrative activity" actions={<Link href="/admin/audit" className="text-xs font-semibold text-[#1F7A4D]">Audit log →</Link>} flush>
          {c.recent.length === 0 ? <EmptyState compact message="No activity recorded yet." /> : (
            <ul className="divide-y divide-[#EEF1ED] text-sm">{c.recent.map((e) => <li key={e.id} className="flex justify-between gap-3 px-4 py-2"><span>{humanize(e.action)} <span className="text-[#849087]">· {e.entityType}</span></span><span className="shrink-0 text-xs text-[#849087]">{e.actor?.name ?? "System"} · {fmtDateTime(e.createdAt)}</span></li>)}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
