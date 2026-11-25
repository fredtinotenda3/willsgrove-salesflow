import Link from "next/link";
import { fmtDateTime } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { DISPATCH_SORT_KEYS, listAdminDispatches } from "@/lib/admin/ops-admin";

type Row = Awaited<ReturnType<typeof listAdminDispatches>>["rows"][number];

export default async function AdminDeliveriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "outcome"], sortKeys: DISPATCH_SORT_KEYS, fallbackSort: { key: "created", dir: "desc" } });
  const { total, rows } = await listAdminDispatches({ q: list.q, status: list.get("status"), outcome: list.get("outcome"), from: list.from, to: list.to }, list.page, list.pageSize, list.sort);
  const columns: Column<Row>[] = [
    { key: "order", header: "Order", sortKey: "order", render: (d) => <Link href={`/admin/orders/${d.order.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{d.order.reference}</Link> },
    { key: "customer", header: "Customer", render: (d) => d.order.customer.name },
    { key: "status", header: "Dispatch", sortKey: "status", render: (d) => <StatusBadge status={d.status} /> },
    { key: "outcome", header: "Delivery outcome", render: (d) => (d.deliveryRecord ? <StatusBadge status={d.deliveryRecord.outcome} /> : <span className="text-[#849087]">Not recorded</span>) },
    { key: "driver", header: "Driver", hideBelow: "md", render: (d) => <>{d.driver?.name ?? "—"}{d.assistant ? <div className="text-xs text-[#849087]">+ {d.assistant.name}</div> : null}</> },
    { key: "vehicle", header: "Vehicle", hideBelow: "md", render: (d) => d.vehicle?.registrationNumber ?? "—" },
    { key: "departed", header: "Departed", sortKey: "departed", hideBelow: "lg", render: (d) => (d.departedAt ? fmtDateTime(d.departedAt) : d.plannedDepartureAt ? `Planned ${fmtDateTime(d.plannedDepartureAt)}` : "—") },
    { key: "recipient", header: "Received by", hideBelow: "xl", defaultHidden: true, render: (d) => d.deliveryRecord?.recipientName ?? "—" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Dispatch & delivery" description="Every dispatch with its driver, vehicle and recorded delivery outcome. Dispatches and proofs of delivery are recorded by the delivery team and are immutable history; a wrong dispatch is cancelled with a reason in the delivery workspace." actions={<Link href="/deliveries" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open delivery workspace</Link>} />
      <TableToolbar tableId="admin-deliveries" searchPlaceholder="Order, customer, vehicle or driver" exportHref={`/api/admin/export/dispatches?${new URLSearchParams(list.params)}`}
        filters={[{ name: "status", label: "Dispatch status", options: opts(["PLANNED", "DEPARTED", "DELIVERED", "CANCELLED"]) }, { name: "outcome", label: "Outcome", options: opts(["ACCEPTED_IN_FULL", "PARTIALLY_REJECTED", "FULLY_REJECTED"]) }]} columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))}>
        <DateRangeFilter action="/admin/deliveries" params={list.params} />
      </TableToolbar>
      <DataTable id="admin-deliveries" columns={columns} rows={rows} rowId={(d) => d.id} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/deliveries" params={list.params} sort={list.sort} />
    </div>
  );
}
