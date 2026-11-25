import Link from "next/link";
import { fmtDate, fmtMoney } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { CREDIT_NOTE_SORT_KEYS, listAdminCreditNotes } from "@/lib/admin/finance-admin";

type Row = Awaited<ReturnType<typeof listAdminCreditNotes>>["rows"][number];

export default async function AdminCreditNotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status"], sortKeys: CREDIT_NOTE_SORT_KEYS, fallbackSort: { key: "created", dir: "desc" } });
  const { total, rows } = await listAdminCreditNotes({ q: list.q, status: list.get("status"), from: list.from, to: list.to }, list.page, list.pageSize, list.sort);
  const columns: Column<Row>[] = [
    { key: "number", header: "Credit note", sortKey: "number", render: (c) => <span className="font-semibold">{c.sapCreditNoteDocNum}</span> },
    { key: "invoice", header: "Invoice", render: (c) => (c.sapInvoice ? <Link href={`/admin/invoices/${c.sapInvoice.id}`} className="text-[#1F7A4D] hover:underline">{c.sapInvoice.sapDocNum}</Link> : "—") },
    { key: "claim", header: "Claim", render: (c) => (c.claim ? <Link href={`/admin/claims/${c.claim.id}`} className="text-[#1F7A4D] hover:underline">{c.claim.claimReference}</Link> : <span className="text-amber-700">Not linked</span>) },
    { key: "amount", header: "Amount", sortKey: "amount", align: "right", render: (c) => fmtMoney(c.currencyCode, c.amount) },
    { key: "status", header: "Match status", sortKey: "status", render: (c) => <StatusBadge status={c.matchStatus} /> },
    { key: "date", header: "Date", sortKey: "date", hideBelow: "md", render: (c) => fmtDate(c.creditNoteDate) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Credit notes" description="SAP credit notes and the claims they settle. They are imported from SAP and linked to claims in the claim workflow; they are never edited or deleted here." actions={<Link href="/returns-credits" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open returns & credits</Link>} />
      <TableToolbar tableId="admin-credit-notes" searchPlaceholder="Credit note, invoice or claim" exportHref={`/api/admin/export/credit-notes?${new URLSearchParams(list.params)}`} filters={[{ name: "status", label: "Match status", options: opts(["UNMATCHED", "AUTO_MATCHED", "MANUALLY_MATCHED", "CANNOT_LINK"]) }]} columns={columns.map((c) => ({ key: c.key, label: c.header }))}>
        <DateRangeFilter action="/admin/credit-notes" params={list.params} />
      </TableToolbar>
      <DataTable id="admin-credit-notes" columns={columns} rows={rows} rowId={(c) => c.id} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/credit-notes" params={list.params} sort={list.sort} />
    </div>
  );
}
