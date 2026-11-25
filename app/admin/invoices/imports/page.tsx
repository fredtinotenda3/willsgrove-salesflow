import Link from "next/link";
import { listImportBatches } from "@/lib/admin/finance-admin";
import { fmtDateTime, fmtInt } from "@/lib/admin/format";
import { DataTable, type Column } from "../../_components/data-table/data-table";
import { Notice, PageHeader } from "../../_components/ui";
import { parseListParams } from "../../_components/list-helpers";
import { requireAdminPage } from "../../_components/admin-shell";

export const instant = false;
type Row = Awaited<ReturnType<typeof listImportBatches>>["rows"][number];

export default async function AdminInvoiceImportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: [], sortKeys: [], fallbackSort: { key: "created", dir: "desc" } });
  const { total, rows } = await listImportBatches(list.page, list.pageSize);
  const columns: Column<Row>[] = [
    { key: "file", header: "File", render: (b) => <Link href={`/admin/invoices?batch=${b.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{b.originalFileName}</Link> },
    { key: "when", header: "Imported", render: (b) => <>{fmtDateTime(b.createdAt)}<div className="text-xs text-[#849087]">{b.uploadedBy?.name ?? "—"}</div></> },
    { key: "rows", header: "Rows", align: "right", hideBelow: "md", render: (b) => fmtInt(b.totalRows) },
    { key: "inv", header: "Invoices", align: "right", render: (b) => fmtInt(b.importedInvoiceCount) },
    { key: "lines", header: "Lines", align: "right", hideBelow: "md", render: (b) => fmtInt(b.importedLineCount) },
    { key: "dup", header: "Duplicates skipped", align: "right", hideBelow: "lg", render: (b) => b.duplicateRowCount },
    { key: "bad", header: "Invalid rows", align: "right", hideBelow: "lg", render: (b) => (b.invalidRowCount ? <span className="font-semibold text-red-700">{b.invalidRowCount}</span> : 0) },
    { key: "open", header: "Open exceptions", align: "right", render: (b) => (b.openExceptions ? <Link href={`/admin/invoices?batch=${b.id}`} className="font-semibold text-amber-700 hover:underline">{b.openExceptions}</Link> : 0) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/invoices", label: "SAP invoices" }} title="Invoice import batches" description="Every confirmed SAP invoice import, with what it created and how many invoices still need reconciliation." actions={<Link href="/invoice-reconciliation/import" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Import invoices</Link>} />
      <Notice tone="info">An import batch is a permanent record of what was loaded and by whom. Batches are never edited or deleted; re-importing a corrected file skips invoices already present.</Notice>
      <DataTable id="admin-import-batches" columns={columns} rows={rows} rowId={(b) => b.id} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/invoices/imports" params={list.params} />
    </div>
  );
}
