import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { getProductDetail } from "@/lib/admin/catalogue-admin";
import { EmptyState, PageHeader, SectionCard } from "../../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { ProductFormDialog } from "../../_components/product-form-dialog";

export const instant = false;

export default async function AdminProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const detail = await getProductDetail(id);
  if (!detail) notFound();
  const { product: p, references, history } = detail;
  const referenced = references.orderLines + references.quotationLines + references.priceEntries;
  return (
    <AdminShell active="/admin/products">
      <PageHeader breadcrumb="Workspace / Administration / Products" title={`${p.sapItemCode} — ${p.itemName}`} description={p.status === "ACTIVE" ? "Active" : "Archived — not offered on new orders or quotations"} actions={<Link href="/admin/products" className="text-sm font-semibold text-[#1F7A4D]">← All products</Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Details">
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <dt className="text-[#849087]">Barcode</dt><dd>{p.barcode ?? "—"}</dd><dt className="text-[#849087]">Category</dt><dd>{p.category ?? "—"}</dd>
            <dt className="text-[#849087]">Unit of measure</dt><dd>{p.unitOfMeasure ?? "—"}</dd><dt className="text-[#849087]">Pack size</dt><dd>{p.packSize ?? "—"}</dd>
            <dt className="text-[#849087]">VAT code</dt><dd>{p.vatCode ?? "—"}</dd><dt className="text-[#849087]">Variable weight</dt><dd>{p.isVariableWeight ? "Yes" : "No"}</dd>
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-[#EEF1ED] p-4">
            <ProductFormDialog initial={{ id: p.id, sapItemCode: p.sapItemCode, itemName: p.itemName, barcode: p.barcode, category: p.category, unitOfMeasure: p.unitOfMeasure, packSize: p.packSize, vatCode: p.vatCode, isVariableWeight: p.isVariableWeight }} />
            {p.status === "ACTIVE" ? <ActionDialog label="Archive" variant="danger" destructive title="Archive this product?" description="It stays on historical orders, quotations and price lists but can no longer be chosen for new ones." endpoint={`/api/admin/products/${p.id}/status`} payload={{ status: "INACTIVE" }} confirmLabel="Archive" /> : <ActionDialog label="Restore" variant="primary" title="Restore this product?" endpoint={`/api/admin/products/${p.id}/status`} payload={{ status: "ACTIVE" }} confirmLabel="Restore" />}
          </div>
        </SectionCard>
        <SectionCard title="Where it is used" description={referenced > 0 ? "Referenced records are why products are archived rather than deleted." : "Not referenced yet."}>
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm"><dt className="text-[#849087]">Order lines</dt><dd>{references.orderLines}</dd><dt className="text-[#849087]">Quotation lines</dt><dd>{references.quotationLines}</dd><dt className="text-[#849087]">Price list entries</dt><dd>{references.priceEntries}</dd></dl>
        </SectionCard>
      </div>
      <SectionCard title="Change history">
        {history.length === 0 ? <EmptyState message="No recorded changes since the audit trail began." /> : (
          <ul className="divide-y divide-[#EEF1ED] text-sm">{history.map((h) => <li key={h.id} className="px-4 py-2"><div className="flex justify-between"><span className="font-medium">{h.action.replace(/_/g, " ").toLowerCase()}</span><span className="text-xs text-[#849087]">{h.actor?.name ?? "System"} · {h.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span></div><pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-[#5F6F66]">{JSON.stringify({ before: h.beforeData, after: h.afterData })}</pre></li>)}</ul>
        )}
      </SectionCard>
    </AdminShell>
  );
}
