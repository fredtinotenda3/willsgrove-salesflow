import Link from "next/link";
import { listPriceListOverview, searchCustomersForPricing } from "@/lib/pricing/workspace";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDate } from "@/lib/admin/format";
import { PageHeader, Panel, Tabs, Notice } from "../_components/ui";
import { EmptyState } from "../../reports/_components/ui";
import { requireAdminPage } from "../_components/admin-shell";
import { StatusBadge } from "../_components/status-badge";

export const instant = false;

const PAGE_SIZE = 25;

export default async function PricingWorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const tab = one(sp.tab) === "customers" ? "customers" : "lists";
  const q = (one(sp.q) ?? "").trim().slice(0, 100);
  const pageRaw = Number(one(sp.page));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return (
    <div className="space-y-4">
      <PageHeader title="Pricing" description="Price lists are shared; customer-specific prices belong to ONE customer and take precedence over that customer's price list. Changing one customer never affects another customer or the shared list. Existing orders keep the price they were created with." actions={<Link href="/admin/price-lists" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Manage price lists</Link>} />
      <Tabs basePath="/admin/pricing" active={tab} tabs={[{ key: "lists", label: "Price lists" }, { key: "customers", label: "Customer-specific prices" }]} />
      {tab === "lists" ? <PriceLists /> : <Customers q={q} page={page} />}
    </div>
  );
}

async function PriceLists() {
  const lists = await listPriceListOverview();
  return (
    <Panel title={`Price lists (${lists.length})`} flush>
      {lists.length === 0 ? <EmptyState message="No price lists yet." /> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">List</th><th className="px-4 py-2">Currency</th><th className="px-4 py-2 text-right">Customers</th><th className="px-4 py-2 text-right">Products</th><th className="px-4 py-2">Effective</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Last updated</th></tr></thead>
          <tbody>{lists.map((l) => (
            <tr key={l.id} className="border-t border-[#EEF1ED]">
              <td className="px-4 py-2"><Link href={`/admin/price-lists/${l.id}`} className="font-mono text-xs text-[#1F7A4D] hover:underline">{l.code}</Link><div className="text-xs text-[#849087]">{l.name}</div></td>
              <td className="px-4 py-2 font-semibold">{l.currencyCode}</td>
              <td className="px-4 py-2 text-right tabular-nums">{l.customers}</td>
              <td className="px-4 py-2 text-right tabular-nums">{l.products}</td>
              <td className="px-4 py-2 text-xs">{l.effectiveFrom ? `${fmtDate(l.effectiveFrom)} → ${l.openEndedEntries > 0 ? "no expiry" : l.effectiveTo ? fmtDate(l.effectiveTo) : "—"}` : "No prices"}</td>
              <td className="px-4 py-2"><StatusBadge status={l.status} /></td>
              <td className="px-4 py-2 text-xs text-[#849087]">{fmtDate(l.lastUpdated)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Panel>
  );
}

async function Customers({ q, page }: { q: string; page: number }) {
  const { total, rows } = await searchCustomersForPricing(q, page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/admin/pricing?tab=customers&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <div className="space-y-3">
      <form method="get" className="flex gap-2">
        <input type="hidden" name="tab" value="customers" />
        <input name="q" defaultValue={q} placeholder="Search customer name or SAP code" className="w-72 rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <button className="rounded-lg bg-[#173D2E] px-4 py-2 text-sm font-semibold text-white">Search</button>
      </form>
      <Notice tone="info">Open a customer to set, edit or remove their own prices, bulk-edit, import or export, and see products that still have no price.</Notice>
      <Panel title={`Customers (${total})`} flush>
        {rows.length === 0 ? <EmptyState message="No customers match." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Price list</th><th className="px-4 py-2">Currency</th><th className="px-4 py-2 text-right">Own prices</th><th className="px-4 py-2" /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2 font-semibold">{c.name}<div className="font-mono text-xs font-normal text-[#849087]">{c.sapCustomerCode ?? "No SAP code"}</div></td>
                <td className="px-4 py-2 font-mono text-xs">{c.priceListCode ?? <span className="text-amber-700">None assigned</span>}</td>
                <td className="px-4 py-2">{c.currencyCode ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{c.overrides}</td>
                <td className="px-4 py-2 text-right"><Link href={`/admin/pricing/customers/${c.id}`} className="rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold">Manage prices</Link></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <div className="flex items-center justify-between border-t border-[#EEF1ED] px-4 py-2 text-xs text-[#849087]">
          <span>Page {page} of {pages}</span>
          <span className="flex gap-3">{page > 1 ? <Link href={href(page - 1)} className="font-semibold text-[#1F7A4D]">Previous</Link> : null}{page < pages ? <Link href={href(page + 1)} className="font-semibold text-[#1F7A4D]">Next</Link> : null}</span>
        </div>
      </Panel>
    </div>
  );
}
