import Link from "next/link";
import { fmtDate, fmtMoney } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { INVOICE_RECON_STATUSES, INVOICE_SORTS, listAdminInvoices } from "@/lib/admin/finance-admin";
import { Notice } from "../_components/ui";

type Row = Awaited<ReturnType<typeof listAdminInvoices>>["rows"][number];

export default async function AdminInvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "batch", "unmatchedLines"], sortKeys: Object.keys(INVOICE_SORTS), fallbackSort: { key: "imported", dir: "desc" } });
  const { total, rows } = await listAdminInvoices({ q: list.q, status: list.get("status"), batchId: list.get("batch"), from: list.from, to: list.to, withUnmatchedLines: list.get("unmatchedLines") === "1" }, list.page, list.pageSize, list.sort);
  const columns: Column<Row>[] = [
    { key: "number", header: "SAP invoice", sortKey: "number", render: (i) => <Link href={`/admin/invoices/${i.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{i.sapDocNum}</Link> },
    { key: "customer", header: "Customer", sortKey: "customer", render: (i) => <div>{i.customerName}<div className="text-xs text-[#849087]">{i.customerSapCode}</div></div> },
    { key: "date", header: "Invoice date", sortKey: "date", hideBelow: "md", render: (i) => fmtDate(i.invoiceDate) },
    { key: "total", header: "Total", sortKey: "total", align: "right", render: (i) => (i.total ? fmtMoney(i.currencyCode, i.total) : "—") },
    { key: "status", header: "Reconciliation", sortKey: "status", render: (i) => <div className="flex flex-wrap gap-1"><StatusBadge status={i.reconciliationStatus} />{i.isCancelledOrReversed ? <StatusBadge status="CANCELLED_REVERSED" /> : null}</div> },
    { key: "unmatched", header: "Unmatched lines", align: "right", hideBelow: "lg", render: (i) => (i.unmatchedLines > 0 ? <span className="font-semibold text-amber-700">{i.unmatchedLines}</span> : 0) },
    { key: "order", header: "Order", hideBelow: "lg", render: (i) => (i.matchedOrder ? <Link href={`/admin/orders/${i.matchedOrder.id}`} className="text-[#1F7A4D] hover:underline">{i.matchedOrder.reference}</Link> : "—") },
    { key: "claims", header: "Claims", align: "right", hideBelow: "xl", render: (i) => i.claimCount },
    { key: "batch", header: "Import file", hideBelow: "xl", defaultHidden: true, render: (i) => i.importBatch.originalFileName },
    { key: "imported", header: "Imported", sortKey: "imported", hideBelow: "xl", defaultHidden: true, render: (i) => fmtDate(i.createdAt) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="SAP invoices" description="Invoices imported from SAP and their reconciliation to orders. SAP data is read-only here: matching and corrections go through the reconciliation workflow, which keeps its own history." actions={<><Link href="/admin/invoices/imports" className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#F7F8F6]">Import batches</Link><Link href="/invoice-reconciliation" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open reconciliation</Link></>} />
      <Notice tone="info">Imported SAP invoices are never edited or deleted from the administration area. A wrong import is corrected by re-importing; cancelled or reversed documents stay visible and are flagged.</Notice>
      <TableToolbar tableId="admin-invoices" searchPlaceholder="Document no., customer or SAP order ref" exportHref={`/api/admin/export/invoices?${new URLSearchParams(list.params)}`}
        filters={[{ name: "status", label: "Reconciliation", options: opts(INVOICE_RECON_STATUSES) }]}
        columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))}>
        <DateRangeFilter action="/admin/invoices" params={list.params} />
      </TableToolbar>
      <DataTable id="admin-invoices" columns={columns} rows={rows} rowId={(i) => i.id} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/invoices" params={list.params} sort={list.sort}
        rowActions={(i) => <Link href={`/admin/invoices/${i.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">View</Link>} />
    </div>
  );
}
