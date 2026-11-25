import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { PageHeader } from "../_components/ui";
import { parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { getStockSnapshotDetail, listStockSnapshots } from "@/lib/admin/ops-admin";
import { EmptyState, Notice, Panel } from "../_components/ui";
import { buildQuery } from "@/lib/admin/list-query";
import { fmtInt } from "@/lib/admin/format";

export default async function AdminStockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "snapshot"], sortKeys: [], fallbackSort: { key: "snapshot", dir: "desc" } });
  const snapshots = await listStockSnapshots(1, 50);
  const selectedId = list.get("snapshot") ?? snapshots.rows[0]?.id;
  const detail = selectedId ? await getStockSnapshotDetail(selectedId, list.q, list.page, list.pageSize) : null;
  type L = NonNullable<typeof detail>["lines"][number];
  const columns: Column<L>[] = [
    { key: "code", header: "Item code", render: (l) => <span className="font-mono text-xs">{l.product.sapItemCode}</span> },
    { key: "name", header: "Item", render: (l) => <Link href={`/admin/products/${l.product.id}`} className="hover:underline">{l.product.itemName}</Link> },
    { key: "warehouse", header: "Warehouse", render: (l) => <>{l.warehouseCode}{l.warehouseName ? <span className="text-[#849087]"> · {l.warehouseName}</span> : null}</> },
    { key: "qty", header: "Quantity", align: "right", render: (l) => `${l.quantity} ${l.unitCode ?? ""}` },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Stock snapshots" description="Stock figures imported from SAP at a point in time. This is a visibility aid, not live inventory: a snapshot is never edited, and a wrong import is replaced by importing a new one." actions={<Link href="/stock" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open stock workspace</Link>} />
      {snapshots.rows.length === 0 ? <EmptyState title="No stock snapshots" message="Import a stock snapshot from the stock workspace to see it here." /> : (
        <>
          <Panel title="Snapshots" flush>
            <ul className="divide-y divide-[#EEF1ED] text-sm">{snapshots.rows.map((s) => <li key={s.id}><Link href={`/admin/stock${buildQuery({ snapshot: s.id })}`} aria-current={s.id === selectedId ? "true" : undefined} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-[#F7F8F6] ${s.id === selectedId ? "bg-[#F1F7F3]" : ""}`}><span><strong>{fmtDateTime(s.snapshotAt)}</strong> <span className="text-[#849087]">{s.sourceFileName ?? "manual"}</span></span><span className="text-xs text-[#5E6B63]">{fmtInt(s._count.lines)} lines · imported {fmtDate(s.importedAt)}</span></Link></li>)}</ul>
          </Panel>
          {detail ? (
            <>
              <Notice tone="info">Snapshot taken {fmtDateTime(detail.snapshot.snapshotAt)} across {detail.warehouses.length} warehouse(s): {detail.warehouses.map((x) => `${x.code} (${fmtInt(x.lines)})`).join(", ") || "none"}.</Notice>
              <TableToolbar tableId="admin-stock" searchPlaceholder="Item code, name or warehouse" columns={columns.map((c) => ({ key: c.key, label: c.header }))} />
              <DataTable id="admin-stock" columns={columns} rows={detail.lines} rowId={(l) => l.id} total={detail.total} page={list.page} pageSize={list.pageSize} basePath="/admin/stock" params={{ ...list.params, snapshot: selectedId }} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
