import Link from "next/link";
import { listAdminProducts, PRODUCT_SORTS } from "@/lib/admin/catalogue-admin";
import { fmtDate } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";
import { ProductFormDialog } from "../_components/product-form-dialog";

export const instant = false;
type Row = Awaited<ReturnType<typeof listAdminProducts>>["rows"][number];

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "category", "scope"], sortKeys: Object.keys(PRODUCT_SORTS), fallbackSort: { key: "code", dir: "asc" } });
  const scope = list.get("scope");
  const { total, rows, categories } = await listAdminProducts({ q: list.q, status: list.get("status"), category: list.get("category"), missingBarcode: scope === "no-barcode", unpriced: scope === "unpriced" }, list.page, list.pageSize, list.sort);
  const columns: Column<Row>[] = [
    { key: "code", header: "SAP code", sortKey: "code", render: (p) => <Link href={`/admin/products/${p.id}`} className="font-mono text-xs font-semibold text-[#1F7A4D] hover:underline">{p.sapItemCode}</Link> },
    { key: "name", header: "Name", sortKey: "name", render: (p) => p.itemName },
    { key: "barcode", header: "Barcode", hideBelow: "md", render: (p) => p.barcode ?? <span className="text-amber-700">missing</span> },
    { key: "category", header: "Category", sortKey: "category", hideBelow: "md", render: (p) => p.category ?? "—" },
    { key: "uom", header: "UoM", hideBelow: "lg", render: (p) => p.unitOfMeasure ?? "—" },
    { key: "prices", header: "Price entries", align: "right", hideBelow: "lg", render: (p) => (p._count.priceListEntries === 0 && p.status === "ACTIVE" ? <span className="font-semibold text-amber-700">0</span> : p._count.priceListEntries) },
    { key: "aliases", header: "Aliases", align: "right", hideBelow: "xl", defaultHidden: true, render: (p) => p._count.aliases },
    { key: "status", header: "Status", sortKey: "status", render: (p) => <StatusBadge status={p.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"} /> },
    { key: "updated", header: "Updated", sortKey: "updated", hideBelow: "xl", defaultHidden: true, render: (p) => fmtDate(p.updatedAt) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Products" description="The SAP item master. Item codes are identifiers and cannot be edited. A product used on any order, quotation or price list is archived, never deleted; one that was never used can be deleted." actions={<><Link href="/products/import" className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#F7F8F6]">Import from SAP</Link><ProductFormDialog /></>} />
      <TableToolbar tableId="admin-products" searchPlaceholder="Code, name or barcode" exportHref="/api/admin/products/export"
        filters={[{ name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Archived" }] }, ...(categories.length ? [{ name: "category", label: "Category", options: categories.map((c) => ({ value: c, label: c })) }] : []), { name: "scope", label: "Data quality", options: opts(["no-barcode", "unpriced"]).map((o) => ({ value: o.value, label: o.value === "no-barcode" ? "Missing barcode" : "Active but on no price list" })) }]}
        columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))} />
      <DataTable id="admin-products" columns={columns} rows={rows} rowId={(p) => p.id} rowLabel={(p) => p.sapItemCode} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/products" params={list.params} sort={list.sort}
        rowActions={(p) => <Link href={`/admin/products/${p.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Manage</Link>} />
    </div>
  );
}
