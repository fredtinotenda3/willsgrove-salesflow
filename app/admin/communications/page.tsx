import Link from "next/link";
import { fmtDateTime, humanize } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader, Tabs } from "../_components/ui";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { ActionDialog } from "../_components/action-dialog";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { listMessageIntakes, listOutboundMessages } from "@/lib/admin/ops-admin";

export default async function AdminCommunicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "channel", "type", "tab"], sortKeys: [], fallbackSort: { key: "created", dir: "desc" } });
  const tab = list.get("tab") === "outbound" ? "outbound" : "inbound";
  const [inbound, outbound] = await Promise.all([
    tab === "inbound" ? listMessageIntakes({ q: list.q, status: list.get("status"), channel: list.get("channel"), from: list.from, to: list.to }, list.page, list.pageSize) : Promise.resolve({ total: 0, rows: [] }),
    tab === "outbound" ? listOutboundMessages({ q: list.q, status: list.get("status"), type: list.get("type"), channel: list.get("channel"), from: list.from, to: list.to }, list.page, list.pageSize) : Promise.resolve({ total: 0, rows: [] }),
  ]);
  type I = (typeof inbound.rows)[number];
  type O = (typeof outbound.rows)[number];
  const inCols: Column<I>[] = [
    { key: "received", header: "Received", render: (m) => fmtDateTime(m.receivedAt) },
    { key: "channel", header: "Channel", hideBelow: "md", render: (m) => humanize(m.channel) },
    { key: "from", header: "From", render: (m) => <>{m.fromDisplayName ?? m.fromAddress}<div className="text-xs text-[#849087]">{m.fromDisplayName ? m.fromAddress : ""}</div></> },
    { key: "subject", header: "Subject", hideBelow: "md", render: (m) => m.subject ?? "—" },
    { key: "customer", header: "Customer", hideBelow: "lg", render: (m) => (m.customer ? <Link href={`/admin/customers/${m.customer.id}`} className="hover:underline">{m.customer.name}</Link> : "—") },
    { key: "status", header: "Status", render: (m) => <StatusBadge status={m.status} /> },
    { key: "order", header: "Order", hideBelow: "lg", render: (m) => (m.linkedOrder ? <Link href={`/admin/orders/${m.linkedOrder.id}`} className="text-[#1F7A4D] hover:underline">{m.linkedOrder.reference}</Link> : "—") },
    { key: "att", header: "Files", align: "right", hideBelow: "xl", render: (m) => m._count.attachments },
  ];
  const outCols: Column<O>[] = [
    { key: "created", header: "Queued", render: (m) => fmtDateTime(m.createdAt) },
    { key: "type", header: "Type", render: (m) => humanize(m.type) },
    { key: "to", header: "To", hideBelow: "md", render: (m) => <>{m.toAddress}<div className="text-xs text-[#849087]">{humanize(m.channel)}</div></> },
    { key: "customer", header: "Customer", hideBelow: "lg", render: (m) => m.customer?.name ?? "—" },
    { key: "ref", header: "Related", hideBelow: "lg", render: (m) => (m.relatedOrder ? <Link href={`/admin/orders/${m.relatedOrder.id}`} className="text-[#1F7A4D] hover:underline">{m.relatedOrder.reference}</Link> : m.relatedQuotation ? <Link href={`/admin/quotations/${m.relatedQuotation.id}`} className="text-[#1F7A4D] hover:underline">{m.relatedQuotation.quotationNumber}</Link> : "—") },
    { key: "status", header: "Status", render: (m) => <StatusBadge status={m.status} /> },
    { key: "attempts", header: "Attempts", align: "right", hideBelow: "md", render: (m) => m.attemptCount },
    { key: "error", header: "Last error", hideBelow: "xl", render: (m) => (m.lastErrorMessage ? <span className="text-red-700">{m.lastErrorMessage.slice(0, 100)}</span> : "—") },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Communications" description="Inbound messages awaiting or having produced orders, and the outbound notifications sent to customers. Messages are an audit trail and are never edited or deleted; a failed outbound message can be resent." actions={<><Link href="/communications/inbox" className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#F7F8F6]">Open inbox</Link><Link href="/reports/communications" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Communications report</Link></>} />
      <Tabs basePath="/admin/communications" active={tab} tabs={[{ key: "inbound", label: "Inbound" }, { key: "outbound", label: "Outbound" }]} params={{}} />
      <TableToolbar tableId={`admin-comms-${tab}`} searchPlaceholder={tab === "inbound" ? "Sender, subject or customer" : "Recipient, subject or customer"}
        filters={tab === "inbound" ? [{ name: "status", label: "Status", options: opts(["RECEIVED", "CONVERTED", "LINKED", "IGNORED", "DUPLICATE"]) }, { name: "channel", label: "Channel", options: opts(["EMAIL", "WHATSAPP", "MANUAL"]) }] : [{ name: "status", label: "Status", options: opts(["QUEUED", "SENT", "FAILED"]) }, { name: "type", label: "Type", options: opts(["QUOTATION_ISSUED", "QUOTATION_RESPONSE_ACKNOWLEDGED", "ORDER_CONFIRMATION", "PICKING_UPDATE", "DISPATCH_NOTIFICATION", "DELIVERY_CONFIRMATION", "DELIVERY_EXCEPTION"]) }, { name: "channel", label: "Channel", options: opts(["EMAIL", "WHATSAPP"]) }]}
        columns={(tab === "inbound" ? inCols : outCols).map((c) => ({ key: c.key, label: c.header }))}>
        <DateRangeFilter action="/admin/communications" params={{ ...list.params, tab }} />
      </TableToolbar>
      {tab === "inbound"
        ? <DataTable id="admin-intake" columns={inCols} rows={inbound.rows} rowId={(m) => m.id} total={inbound.total} page={list.page} pageSize={list.pageSize} basePath="/admin/communications" params={{ ...list.params, tab }} rowActions={(m) => <Link href={`/communications/inbox/${m.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Open</Link>} />
        : <DataTable id="admin-outbound" columns={outCols} rows={outbound.rows} rowId={(m) => m.id} total={outbound.total} page={list.page} pageSize={list.pageSize} basePath="/admin/communications" params={{ ...list.params, tab }} rowActions={(m) => m.status === "FAILED" ? <ActionDialog label="Resend" title="Resend this message?" description="Sends the same message again through the original channel and records the attempt." endpoint={`/api/communications/${m.id}/resend`} askReason={false} confirmLabel="Resend" /> : null} />}
    </div>
  );
}
