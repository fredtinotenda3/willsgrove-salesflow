import Link from "next/link";
import { getDataQuality, getDemoCounts } from "@/lib/admin/data-quality";
import { DELETION_POLICY } from "@/lib/admin/deletion-policy";
import { humanize } from "@/lib/admin/format";
import { Notice, PageHeader, Panel, Tabs } from "../_components/ui";
import { DownloadButton } from "../_components/download-button";
import { requireAdminPage } from "../_components/admin-shell";
import { firstParam as one } from "@/lib/admin/paging";

export const instant = false;

const IMPORTS = [
  { href: "/products/import", title: "Products (catalogue import)", text: "CSV/Excel import with preview, duplicate detection and row-level errors before anything is written." },
  { href: "/item-master/import", title: "Item master (SAP)", text: "SAP item-master import with preview and row-level validation." },
  { href: "/customers/master-import", title: "Customers (SAP customer master)", text: "Preview, validation and a failed-row report before confirming." },
  { href: "/price-lists/import", title: "Price lists", text: "SAP price-list CSV/Excel with preview; historical transaction prices are never rewritten." },
  { href: "/tax-codes/import", title: "Tax codes", text: "Tax-code import with preview." },
  { href: "/returns-credits/import", title: "Credit notes & returns", text: "Credit-note import with preview, import history and matching." },
  { href: "/invoice-reconciliation/import", title: "SAP invoices", text: "Invoice import with import history." },
];
const EXPORTS = [
  { href: "/api/admin/products/export", title: "Products" }, { href: "/api/admin/products/export?template=1", title: "Product template (headers only)" }, { href: "/api/admin/customers/export", title: "Customers" },
  { href: "/api/admin/export/orders", title: "Orders" }, { href: "/api/admin/export/quotations", title: "Quotations" }, { href: "/api/admin/export/invoices", title: "SAP invoices" }, { href: "/api/admin/export/claims", title: "Claims" },
  { href: "/api/admin/export/credit-notes", title: "Credit notes" }, { href: "/api/admin/export/returns", title: "Returns" }, { href: "/api/admin/export/approvals", title: "Approvals" }, { href: "/api/admin/export/dispatches", title: "Dispatch & delivery" },
  { href: "/api/admin/export/price-lists", title: "Price lists (summary)" }, { href: "/api/admin/users/export", title: "Users (no credentials)" }, { href: "/api/admin/audit/export", title: "Audit log (latest 5,000)" },
];
const KIND: Record<string, string> = { HARD_DELETE_IF_UNREFERENCED: "Delete if unreferenced", SOFT_DELETE: "Reset", ARCHIVE: "Archive", DEACTIVATE: "Deactivate", IMMUTABLE: "Immutable", BUSINESS_TRANSACTION: "Business record" };

export default async function AdminDataPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const requested = one((await searchParams).tab);
  const tab = ["imports", "exports", "quality", "policy", "demo"].includes(requested ?? "") ? (requested as string) : "imports";
  const [quality, demo] = await Promise.all([tab === "quality" ? getDataQuality() : Promise.resolve([]), tab === "demo" ? getDemoCounts() : Promise.resolve(null)]);
  return (
    <div className="space-y-4">
      <PageHeader title="Data management" description="Imports use the existing, tested import screens (preview, validation, row-level errors, confirmation, history). Exports are recorded in the audit log. Nothing here can wipe or reset data." />
      <Tabs basePath="/admin/data" active={tab} tabs={[{ key: "imports", label: "Imports" }, { key: "exports", label: "Exports" }, { key: "quality", label: "Data quality" }, { key: "policy", label: "Deletion policy" }, { key: "demo", label: "Demo data" }]} />
      {tab === "imports" ? <Panel title="Imports" flush><ul className="divide-y divide-[#EEF1ED]">{IMPORTS.map((i) => <li key={i.href}><Link href={i.href} className="block px-4 py-3 text-sm hover:bg-[#F7F8F6]"><span className="font-semibold text-[#14211B]">{i.title}</span><span className="block text-xs text-[#5F6F66]">{i.text}</span></Link></li>)}<li><Link href="/admin/invoices/imports" className="block px-4 py-3 text-sm hover:bg-[#F7F8F6]"><span className="font-semibold text-[#14211B]">Invoice import history</span><span className="block text-xs text-[#5F6F66]">What each SAP invoice import created and which invoices still need reconciliation.</span></Link></li></ul></Panel> : null}
      {tab === "exports" ? <Panel title="Exports" description="Each export is a CSV and writes a DATA_EXPORT audit event. List screens also export their current filtered view." flush><ul className="divide-y divide-[#EEF1ED]">{EXPORTS.map((e) => <li key={e.href} className="flex items-center justify-between px-4 py-3 text-sm"><span>{e.title}</span><DownloadButton href={e.href} className="text-xs font-semibold text-[#1F7A4D]">Download</DownloadButton></li>)}</ul></Panel> : null}
      {tab === "quality" ? <Panel title="Data quality" description="Each line counts records that will cause friction (unassigned work, missing prices, unmatched invoices). Click one to open exactly those records." flush><ul className="divide-y divide-[#EEF1ED]">{quality.map((q) => <li key={q.label}><Link href={q.href} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[#F7F8F6]"><span>{q.label}</span><span className={`rounded-md px-2 py-0.5 text-xs font-bold ${q.count > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{q.count}</span></Link></li>)}</ul></Panel> : null}
      {tab === "policy" ? <Panel title="What can be deleted" description="The explicit policy the server enforces. Entities without a delete route cannot be removed from administration at all." flush>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Entity</th><th className="px-4 py-2">Treatment</th><th className="px-4 py-2">Rule</th><th className="px-4 py-2">Instead</th></tr></thead>
          <tbody>{DELETION_POLICY.map((p) => <tr key={p.entity} className="border-t border-[#EEF1ED] align-top"><td className="px-4 py-2 font-medium">{p.entity}</td><td className="px-4 py-2"><div className="flex flex-wrap gap-1">{p.kinds.map((k) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{KIND[k] ?? humanize(k)}</span>)}</div></td><td className="px-4 py-2 text-[#5F6F66]">{p.summary}</td><td className="px-4 py-2 text-[#5F6F66]">{p.alternative}</td></tr>)}</tbody></table></div></Panel> : null}
      {tab === "demo" && demo ? (
        <div className="space-y-4">
          <Panel title="Demo data in this database" description="Rows flagged as demo by the seed script."><ul className="divide-y divide-[#EEF1ED] text-sm">{demo.rows.map((r) => <li key={r.label} className="flex justify-between px-4 py-2.5"><span>{r.label}</span><span className="font-semibold tabular-nums">{r.count}</span></li>)}</ul></Panel>
          <Notice tone={demo.total ? "warn" : "info"} title={demo.total ? `${demo.total} demo row(s) present` : "No demo data present"}>Demo data is removed with the reviewed command-line script, which deletes only rows flagged as demo and never real data: <code className="rounded bg-white/60 px-1">npm run db:remove-demo</code>. Take a database backup first. There is intentionally no reset or wipe button in the browser.</Notice>
        </div>
      ) : null}
    </div>
  );
}
