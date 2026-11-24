import Link from "next/link";
import { listAdminProducts } from "@/lib/admin/catalogue-admin";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { DownloadButton } from "../_components/download-button";
import { ProductFormDialog } from "../_components/product-form-dialog";

export const instant = false;

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const filters = { q: one(raw.q), status: one(raw.status), category: one(raw.category), missingBarcode: one(raw.missingBarcode) === "1" };
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const { total, rows, categories } = await listAdminProducts(filters, page, pageSize);
  const sp = { q: filters.q, status: filters.status, category: filters.category, missingBarcode: filters.missingBarcode ? "1" : undefined };
  return (
    <AdminShell active="/admin/products">
      <PageHeader breadcrumb="Workspace / Administration / Products" title="Products & catalogue" description="SAP item codes are identifiers and cannot be edited. Products are archived, never deleted, because orders, quotations and prices reference them." actions={<div className="flex gap-2"><DownloadButton href="/api/admin/products/export">Export CSV</DownloadButton><Link href="/products/import" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Import from SAP</Link><ProductFormDialog /></div>} />
      <form action="/admin/products" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={filters.q ?? ""} placeholder="Code, name or barcode" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Archived</option></select>
        <select name="category" defaultValue={filters.category ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any category</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingBarcode" value="1" defaultChecked={filters.missingBarcode} />Missing barcode</label>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Products (${total})`}>
        {rows.length === 0 ? <EmptyState message="No products match these filters." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Code</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Barcode</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">UoM</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2 font-mono text-xs"><Link href={`/admin/products/${p.id}`} className="text-[#1F7A4D] hover:underline">{p.sapItemCode}</Link></td>
                <td className="px-4 py-2">{p.itemName}</td><td className="px-4 py-2 text-xs">{p.barcode ?? <span className="text-amber-700">missing</span>}</td>
                <td className="px-4 py-2 text-xs">{p.category ?? "—"}</td><td className="px-4 py-2 text-xs">{p.unitOfMeasure ?? "—"}</td>
                <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${p.status === "ACTIVE" ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-600"}`}>{p.status === "ACTIVE" ? "Active" : "Archived"}</span></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <Pagination basePath="/admin/products" searchParams={sp} page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} />
      </SectionCard>
    </AdminShell>
  );
}
