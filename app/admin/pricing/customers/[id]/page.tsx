import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDateTime } from "@/lib/admin/format";
import { getCustomerPriceView, listCustomerPriceHistory } from "@/lib/pricing/customer-prices";
import { PageHeader, Panel, Stat, Notice, Tabs } from "../../../_components/ui";
import { requireAdminPage } from "../../../_components/admin-shell";
import { ImportPanel, PriceEditor } from "./price-editor";
import { formatCurrencyAmount } from "@/lib/format/currency";

export const instant = false;
const PAGE_SIZE = 50;

export default async function CustomerPricingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const sp = await searchParams;
  const showRaw = one(sp.show);
  const show = showRaw === "overrides" || showRaw === "inherited" || showRaw === "missing" ? showRaw : "all";
  const q = (one(sp.q) ?? "").trim().slice(0, 100);
  const pageRaw = Number(one(sp.page));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const section = one(sp.section) === "history" ? "history" : one(sp.section) === "import" ? "import" : "prices";

  const view = await getCustomerPriceView(id, { q, show, page, pageSize: PAGE_SIZE });
  if (!view) notFound();
  const { customer } = view;
  const pages = Math.max(1, Math.ceil(view.totalMatching / PAGE_SIZE));
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), show, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
    return `/admin/pricing/customers/${id}?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/pricing?tab=customers", label: "Customer pricing" }} title={`${customer.name} — prices`} description="A price saved here applies to this customer only. It overrides their price list for that product, never changes the shared list or any other customer, and never alters orders already created."
        actions={<><a href={`/api/admin/customers/${id}/prices/export`} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Export CSV</a><Link href={`/admin/customers/${id}`} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Customer profile</Link></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Currency" value={view.effectiveCurrency ?? "Not set"} hint={customer.priceListCode ? `List ${customer.priceListCode}` : "No price list assigned"} tone={view.effectiveCurrency ? "neutral" : "warn"} />
        <Stat label="Own prices" value={String(view.overrideCount)} hint="Overrides for this customer" />
        <Stat label="Products without price" value={String(view.withoutPriceCount)} hint="Active, no override, not on the list" tone={view.withoutPriceCount > 0 ? "warn" : "good"} href={qs({ show: "missing" })} />
        <Stat label="Shown" value={String(view.totalMatching)} hint={`Filter: ${show}`} />
      </div>
      {!view.effectiveCurrency ? <Notice tone="warn" title="No currency">This customer has no price list or currency. The first price you save needs a currency (USD or ZWG) — assign a price list or set the customer currency first.</Notice> : null}
      <Tabs basePath={`/admin/pricing/customers/${id}`} active={section} params={{ q: q || undefined, show }} tabs={[{ key: "prices", label: "Prices" }, { key: "import", label: "Import / export" }, { key: "history", label: "History" }]} />
      {section === "prices" ? (
        <Panel title="Products" flush actions={
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input name="q" defaultValue={q} placeholder="Search product or SAP code" className="w-56 rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-sm" />
            <select name="show" defaultValue={show} className="rounded-lg border border-[#DDE3DC] px-2 py-1.5 text-sm">
              <option value="all">All products</option><option value="overrides">Customer overrides</option><option value="inherited">Inherited from list</option><option value="missing">Without a price</option>
            </select>
            <button className="rounded-lg bg-[#173D2E] px-3 py-1.5 text-sm font-semibold text-white">Filter</button>
          </form>}>
          <PriceEditor customerId={id} rows={view.rows} effectiveCurrency={view.effectiveCurrency} />
          <div className="flex items-center justify-between border-t border-[#EEF1ED] px-4 py-2 text-xs text-[#849087]">
            <span>Page {page} of {pages}</span>
            <span className="flex gap-3">{page > 1 ? <Link href={qs({ page: page - 1 })} className="font-semibold text-[#1F7A4D]">Previous</Link> : null}{page < pages ? <Link href={qs({ page: page + 1 })} className="font-semibold text-[#1F7A4D]">Next</Link> : null}</span>
          </div>
        </Panel>
      ) : null}
      {section === "import" ? <Panel title="Import customer prices (CSV)" description="Columns: sapItemCode, unitPrice (required); currency, notes (optional). Validation first, then import; any invalid row rejects the whole file."><div className="p-4"><ImportPanel customerId={id} /></div></Panel> : null}
      {section === "history" ? <History customerId={id} /> : null}
    </div>
  );
}

async function History({ customerId }: { customerId: string }) {
  const rows = await listCustomerPriceHistory(customerId, null, 100);
  return (
    <Panel title="Price change history" description="Append-only. Most recent 100 changes." flush>
      {rows.length === 0 ? <p className="p-6 text-center text-sm text-[#849087]">No changes recorded.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Item</th><th className="px-4 py-2">Change</th><th className="px-4 py-2">Old</th><th className="px-4 py-2">New</th><th className="px-4 py-2">By</th><th className="px-4 py-2">Via</th></tr></thead>
          <tbody>{rows.map((h) => (
            <tr key={h.id} className="border-t border-[#EEF1ED]"><td className="px-4 py-2 text-xs">{fmtDateTime(h.createdAt)}</td><td className="px-4 py-2 font-mono text-xs">{h.sapItemCode ?? h.productId}</td><td className="px-4 py-2 text-xs font-semibold">{h.changeType}</td><td className="px-4 py-2 tabular-nums">{h.oldUnitPrice ? formatCurrencyAmount(h.currencyCode, h.oldUnitPrice, 4) : "—"}</td><td className="px-4 py-2 tabular-nums">{h.newUnitPrice ? formatCurrencyAmount(h.currencyCode, h.newUnitPrice, 4) : "—"}</td><td className="px-4 py-2 text-xs">{h.actorName ?? "—"}</td><td className="px-4 py-2 text-xs">{h.source}{h.reason ? ` · ${h.reason}` : ""}</td></tr>))}</tbody>
        </table></div>
      )}
    </Panel>
  );
}
