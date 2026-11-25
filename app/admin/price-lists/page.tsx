import Link from "next/link";
import { listAdminPriceLists } from "@/lib/admin/catalogue-admin";
import { PageHeader, Panel as SectionCard } from "../_components/ui";
import { EmptyState } from "../../reports/_components/ui";
import { requireAdminPage } from "../_components/admin-shell";
import { ActionDialog } from "../_components/action-dialog";

export const instant = false;

export default async function AdminPriceListsPage() {
  await requireAdminPage();
  const lists = await listAdminPriceLists();
  return (
    <div className="space-y-4">
      <PageHeader title="Price lists" description="Each list has one currency (USD or ZWG); currencies are never mixed. Price entries, effective dates and history are managed on each list and through the SAP price-list import. Deactivating a list never alters historical order or quotation prices." actions={<div className="flex gap-2"><ActionDialog label="New price list" variant="primary" title="New price list" description="The code and currency are permanent. Add prices on the list afterwards or import them." endpoint="/api/admin/price-lists" askReason={false} confirmLabel="Create" successHref="/admin/price-lists/{id}" fields={[{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "currencyCode", label: "Currency", type: "select", defaultValue: "USD", options: [{ value: "USD", label: "USD" }, { value: "ZWG", label: "ZWG" }] }]} /><Link href="/price-lists/import" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Import prices</Link><Link href="/price-lists/customers" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Customer pricing</Link></div>} />
      <SectionCard title={`Price lists (${lists.length})`}>
        {lists.length === 0 ? <EmptyState message="No price lists yet. Import one from SAP." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Code</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Currency</th><th className="px-4 py-2">Entries</th><th className="px-4 py-2">Customers</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{lists.map((l) => (
              <tr key={l.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2 font-mono text-xs"><Link href={`/admin/price-lists/${l.id}`} className="text-[#1F7A4D] hover:underline">{l.code}</Link></td>
                <td className="px-4 py-2">{l.name}</td><td className="px-4 py-2">{l.currencyCode}</td><td className="px-4 py-2">{l.entries}</td><td className="px-4 py-2">{l.customers}</td>
                <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${l.status === "ACTIVE" ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-600"}`}>{l.status}</span></td>
                <td className="px-4 py-2"><div className="flex gap-2">
                  <Link href={`/admin/price-lists/${l.id}`} className="rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold">Prices</Link>
                  <ActionDialog label="Rename" title={`Rename ${l.code}`} description="The code and currency are identifiers and cannot be changed." endpoint={`/api/admin/price-lists/${l.id}`} method="PATCH" confirmLabel="Save" fields={[{ name: "name", label: "Name", type: "text", required: true, defaultValue: l.name }]} />
                  {l.status === "ACTIVE" ? <ActionDialog label="Deactivate" variant="danger" destructive title={`Deactivate ${l.code}?`} description={l.customers > 0 ? `${l.customers} customer(s) still use this list; move them first.` : "It can no longer be assigned to customers. Existing prices and history are kept."} endpoint={`/api/admin/price-lists/${l.id}/status`} payload={{ status: "INACTIVE" }} confirmLabel="Deactivate" /> : <ActionDialog label="Activate" variant="primary" title={`Activate ${l.code}?`} endpoint={`/api/admin/price-lists/${l.id}/status`} payload={{ status: "ACTIVE" }} confirmLabel="Activate" />}
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </SectionCard>
    </div>
  );
}
