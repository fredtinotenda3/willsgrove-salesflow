import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { getAdminPriceList, listEntriesForClassification } from "@/lib/admin/catalogue-admin";
import { classifyPriceEntries } from "@/lib/admin/order-policy";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, MetricCard, PageHeader, Pagination, SectionCard } from "../../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { StatusBadge } from "../../_components/status-badge";

export const instant = false;
const STATE_TONE = { current: "bg-green-50 text-green-800", expired: "bg-gray-100 text-gray-600", future: "bg-blue-50 text-blue-800", conflict: "bg-red-50 text-red-700" } as const;

export default async function AdminPriceListDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const raw = await searchParams;
  const q = one(raw.q);
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const found = await getAdminPriceList(id);
  if (!found) notFound();
  const { list, customers } = found;
  const { total, rows, all } = await listEntriesForClassification(id, q, page, pageSize);
  const states = classifyPriceEntries(all, new Date());
  const counts = { current: 0, expired: 0, future: 0, conflict: 0 };
  for (const s of states.values()) counts[s] += 1;
  return (
    <AdminShell active="/admin/price-lists">
      <PageHeader breadcrumb="Workspace / Administration / Pricing" title={`${list.code} — ${list.name}`} description={`${list.currencyCode} prices only. Orders and quotations keep the price they were created with; changes here affect new documents only.`} actions={<div className="flex gap-2"><Link href="/price-lists/import" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Import prices</Link><Link href="/admin/price-lists" className="px-3 py-2 text-sm font-semibold text-[#1F7A4D]">← All lists</Link></div>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Current prices" value={String(counts.current)} />
        <MetricCard title="Expired" value={String(counts.expired)} description="End date has passed" />
        <MetricCard title="Future-dated" value={String(counts.future)} />
        <MetricCard title="Conflicting" value={String(counts.conflict)} description="Same item, overlapping dates" />
      </div>
      <SectionCard title={`Prices (${total})`} description={`Status ${list.status} · ${list._count.customers} customer(s) use this list${customers.length ? `: ${customers.map((c) => c.name).join(", ")}${list._count.customers > customers.length ? "…" : ""}` : ""}`}>
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3">
          <form action={`/admin/price-lists/${id}`} className="flex gap-2"><input name="q" defaultValue={q ?? ""} placeholder="SAP code or product" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" /><button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Search</button></form>
          {list.status === "ACTIVE" ? <ActionDialog label="Add price" variant="primary" title="Add price" description={`Price in ${list.currencyCode}. The item must exist in the catalogue; dates for the same item cannot overlap.`} endpoint={`/api/admin/price-lists/${id}/entries`} confirmLabel="Add price" fields={[{ name: "sapItemCode", label: "SAP item code", type: "text", required: true }, { name: "unitPrice", label: `Unit price (${list.currencyCode})`, type: "text", required: true, placeholder: "0.45" }, { name: "validFrom", label: "Valid from", type: "date", required: true }, { name: "validTo", label: "Valid to (leave blank if open-ended)", type: "date" }]} /> : <StatusBadge status="INACTIVE" />}
        </div>
        {rows.length === 0 ? <EmptyState message="No prices on this list yet. Add one or import a price file." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">SAP code</th><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">Price ({list.currencyCode})</th><th className="px-4 py-2">Valid</th><th className="px-4 py-2">State</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{rows.map((e) => {
              const st = states.get(e.id) ?? "current";
              return (
                <tr key={e.id} className="border-t border-[#EEF1ED]">
                  <td className="px-4 py-2 font-mono text-xs">{e.sapItemCode}</td><td className="px-4 py-2">{e.productName ?? "—"}</td><td className="px-4 py-2 text-right font-mono">{e.unitPrice}</td>
                  <td className="px-4 py-2 text-xs">{e.validFrom.toISOString().slice(0, 10)} → {e.validTo ? e.validTo.toISOString().slice(0, 10) : "open"}</td>
                  <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATE_TONE[st]}`}>{st}</span></td>
                  <td className="px-4 py-2"><div className="flex gap-2">
                    <ActionDialog label="Change price" title={`Change price of ${e.sapItemCode}`} description="Recorded in the audit log with the old and new price." endpoint={`/api/price-lists/entries/${e.id}`} method="PATCH" askReason={false} confirmLabel="Save price" fields={[{ name: "unitPrice", label: `Unit price (${list.currencyCode})`, type: "text", required: true, defaultValue: e.unitPrice }]} />
                    <ActionDialog label="Remove" variant="danger" destructive title={`Remove price of ${e.sapItemCode}?`} description="Existing orders and quotations keep their own prices. The removed price stays in the audit log." endpoint={`/api/admin/price-lists/entries/${e.id}`} method="DELETE" confirmLabel="Remove" />
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <Pagination basePath={`/admin/price-lists/${id}`} searchParams={{ q }} page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} />
      </SectionCard>
    </AdminShell>
  );
}
