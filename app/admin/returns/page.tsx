import Link from "next/link";
import { fmtDate } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { PageHeader } from "../_components/ui";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { listAdminReturns, RETURN_SORT_KEYS } from "@/lib/admin/finance-admin";

type Row = Awaited<ReturnType<typeof listAdminReturns>>["rows"][number];

export default async function AdminReturnsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "condition"], sortKeys: RETURN_SORT_KEYS, fallbackSort: { key: "received", dir: "desc" } });
  const { total, rows } = await listAdminReturns({ q: list.q, condition: list.get("condition"), from: list.from, to: list.to }, list.page, list.pageSize, list.sort);
  const columns: Column<Row>[] = [
    { key: "reference", header: "Return", sortKey: "reference", render: (r) => <span className="font-semibold">{r.returnReference}</span> },
    { key: "claim", header: "Claim", render: (r) => <Link href={`/admin/claims/${r.claim.id}`} className="text-[#1F7A4D] hover:underline">{r.claim.claimReference}</Link> },
    { key: "customer", header: "Customer", hideBelow: "md", render: (r) => r.claim.customer.name },
    { key: "item", header: "Item", hideBelow: "lg", render: (r) => (r.claimLine ? `${r.claimLine.sapItemCodeSnapshot} — ${r.claimLine.sapItemDescriptionSnapshot}` : "—") },
    { key: "qty", header: "Quantity", sortKey: "quantity", align: "right", render: (r) => r.receivedQuantity },
    { key: "condition", header: "Condition", sortKey: "condition", render: (r) => r.condition.replace(/_/g, " ").toLowerCase() },
    { key: "credit", header: "Credit note", hideBelow: "lg", render: (r) => r.creditNote?.sapCreditNoteDocNum ?? "—" },
    { key: "received", header: "Received", sortKey: "received", hideBelow: "md", render: (r) => <>{fmtDate(r.receivedDate)}{r.receivedBy ? <div className="text-xs text-[#849087]">{r.receivedBy.name}</div> : null}</> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Returns" description="Goods received back against claims. Returns are recorded in the claim workflow, where stock condition and the credit-note link are validated." actions={<Link href="/returns-credits" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open returns & credits</Link>} />
      <TableToolbar tableId="admin-returns" searchPlaceholder="Return or claim reference" exportHref={`/api/admin/export/returns?${new URLSearchParams(list.params)}`} filters={[{ name: "condition", label: "Condition", options: opts(["GOOD_RESALABLE", "DAMAGED", "EXPIRED", "OTHER"]) }]} columns={columns.map((c) => ({ key: c.key, label: c.header }))}>
        <DateRangeFilter action="/admin/returns" params={list.params} />
      </TableToolbar>
      <DataTable id="admin-returns" columns={columns} rows={rows} rowId={(r) => r.id} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/returns" params={list.params} sort={list.sort} />
    </div>
  );
}
