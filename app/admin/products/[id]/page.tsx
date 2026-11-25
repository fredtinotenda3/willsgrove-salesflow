import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { getProductDetail } from "@/lib/admin/catalogue-admin";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDate } from "@/lib/admin/format";
import { KeyValueGrid, PageHeader, Panel, Tabs } from "../../_components/ui";
import { AuditTrail, DeleteSection, MiniTable } from "../../_components/detail-parts";
import { StatusBadge } from "../../_components/status-badge";
import { requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { ProductFormDialog } from "../../_components/product-form-dialog";

export const instant = false;

export default async function AdminProductDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const detail = await getProductDetail(id);
  if (!detail) notFound();
  const { product: p, references, aliases, history, canDelete } = detail;
  const requested = one((await searchParams).tab);
  const tab = ["overview", "aliases", "usage", "activity", "actions"].includes(requested ?? "") ? (requested as string) : "overview";
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/products", label: "All products" }} title={`${p.sapItemCode} — ${p.itemName}`} description={p.status === "ACTIVE" ? "Active" : "Archived — not offered on new orders or quotations"} actions={<StatusBadge status={p.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"} />} />
      <Tabs basePath={`/admin/products/${p.id}`} active={tab} tabs={[{ key: "overview", label: "Overview" }, { key: "aliases", label: "Aliases", count: aliases.length }, { key: "usage", label: "Where used" }, { key: "activity", label: "Activity" }, { key: "actions", label: "Actions" }]} />
      {tab === "overview" ? <Panel title="Details"><KeyValueGrid columns={3} items={[{ label: "SAP item code", value: <span className="font-mono">{p.sapItemCode}</span> }, { label: "Name", value: p.itemName }, { label: "Barcode", value: p.barcode ?? "—" }, { label: "Category", value: p.category ?? "—" }, { label: "Unit of measure", value: p.unitOfMeasure ?? "—" }, { label: "Pack size", value: p.packSize ?? "—" }, { label: "VAT code", value: p.vatCode ?? "—" }, { label: "Variable weight", value: p.isVariableWeight ? "Yes" : "No" }, { label: "Demo data", value: p.isDemo ? "Yes" : "No" }]} /></Panel> : null}
      {tab === "aliases" ? <Panel title="Learned aliases" description="Names customers and staff have used for this product, learned from confirmed matches. Removing an alias only stops automatic matching; it is relearned if confirmed again." flush><MiniTable empty="No aliases have been learned for this product." head={["Alias text", "Scope", "Confirmed", "Last confirmed", ""]} rows={aliases.map((a) => [a.rawText, a.customerId ? "One customer" : "All customers", `${a.timesConfirmed}×`, fmtDate(a.lastConfirmedAt), <ActionDialog key="r" label="Remove" variant="danger" destructive title="Remove this alias?" endpoint={`/api/admin/products/aliases/${a.id}`} method="DELETE" confirmLabel="Remove alias" />])} /></Panel> : null}
      {tab === "usage" ? <Panel title="Where it is used" description="Referenced records are why a product is archived rather than deleted."><KeyValueGrid columns={3} items={[{ label: "Order lines", value: references.orderLines }, { label: "Quotation lines", value: references.quotationLines }, { label: "Price-list entries", value: <Link href="/admin/price-lists" className="text-[#1F7A4D] hover:underline">{references.priceEntries}</Link> }]} /></Panel> : null}
      {tab === "activity" ? <AuditTrail events={history} /> : null}
      {tab === "actions" ? (
        <div className="space-y-4">
          <Panel title="Manage"><div className="flex flex-wrap gap-2 p-4">
            <ProductFormDialog initial={{ id: p.id, sapItemCode: p.sapItemCode, itemName: p.itemName, barcode: p.barcode, category: p.category, unitOfMeasure: p.unitOfMeasure, packSize: p.packSize, vatCode: p.vatCode, isVariableWeight: p.isVariableWeight }} />
            {p.status === "ACTIVE" ? <ActionDialog label="Archive" variant="danger" destructive title="Archive this product?" description="It stays on historical orders, quotations and price lists but can no longer be chosen for new ones." endpoint={`/api/admin/products/${p.id}/status`} payload={{ status: "INACTIVE" }} confirmLabel="Archive" /> : <ActionDialog label="Restore" variant="primary" title="Restore this product?" endpoint={`/api/admin/products/${p.id}/status`} payload={{ status: "ACTIVE" }} confirmLabel="Restore" />}
          </div></Panel>
          <DeleteSection verdict={canDelete} noun="product" endpoint={`/api/admin/products/${p.id}/delete`} confirmText={p.sapItemCode} redirect="/admin/products" alternative="Archive the product instead. It disappears from new orders and quotations, and stays on every historical document." lines={aliases.length ? [`${aliases.length} learned alias(es) are removed with it.`] : []} />
        </div>
      ) : null}
    </div>
  );
}
