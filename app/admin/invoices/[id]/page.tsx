import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDate, fmtDateTime, fmtMoney, humanize } from "@/lib/admin/format";
import { KeyValueGrid, Notice, PageHeader, Panel, Stat, Tabs } from "../../_components/ui";
import { MiniTable } from "../../_components/detail-parts";
import { requireAdminPage } from "../../_components/admin-shell";
import { StatusBadge } from "../../_components/status-badge";
import { getAdminInvoiceDetail } from "@/lib/admin/finance-admin";

export const instant = false;
const link = (href: string, text: string) => <Link href={href} className="text-[#1F7A4D] hover:underline">{text}</Link>;
const tabOf = (raw: string | undefined, allowed: string[]) => (raw && allowed.includes(raw) ? raw : allowed[0]);


const TABS = ["overview", "lines", "claims", "delivery"];

export default async function AdminInvoiceDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const d = await getAdminInvoiceDetail(id);
  if (!d) notFound();
  const { invoice: i, lineStatusCounts } = d;
  const tab = tabOf(one((await searchParams).tab), TABS);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/invoices", label: "All invoices" }} title={`SAP invoice ${i.sapDocNum}`} description={`${i.customerName} · ${fmtDate(i.invoiceDate)}`} actions={<><StatusBadge status={i.reconciliationStatus} />{i.isCancelledOrReversed ? <StatusBadge status="CANCELLED_REVERSED" /> : null}<Link href={`/invoice-reconciliation/${i.id}`} className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open reconciliation</Link></>} />
      <Tabs basePath={`/admin/invoices/${i.id}`} active={tab} tabs={[{ key: "overview", label: "Overview" }, { key: "lines", label: "Lines", count: i.lines.length }, { key: "claims", label: "Claims & credit notes", count: i.claims.length + i.creditNotes.length }, { key: "delivery", label: "Delivery proof" }]} />
      {tab === "overview" ? (
        <div className="space-y-4">
          <Notice tone="info">SAP data is read-only here. Matching lines to orders, re-running the match and recording notes happen in the reconciliation workflow, which keeps its own history.</Notice>
          <div className="grid gap-3 sm:grid-cols-3"><Stat label="Subtotal" value={i.subtotal ? fmtMoney(i.currencyCode, i.subtotal) : "—"} /><Stat label="Tax" value={i.taxTotal ? fmtMoney(i.currencyCode, i.taxTotal) : "—"} /><Stat label="Total" value={i.total ? fmtMoney(i.currencyCode, i.total) : "—"} /></div>
          <Panel title="Invoice"><KeyValueGrid columns={3} items={[
            { label: "Document no.", value: i.sapDocNum }, { label: "SAP doc entry", value: i.sapDocEntry ?? "—" }, { label: "SAP status", value: i.documentStatusRaw ?? "—" },
            { label: "Customer", value: i.matchedCustomer ? link(`/admin/customers/${i.matchedCustomer.id}`, i.matchedCustomer.name) : `${i.customerName} (not matched)` }, { label: "SAP customer code", value: i.customerSapCode ?? "—" }, { label: "SAP order reference", value: i.sapOrderReference ?? "—" },
            { label: "Matched order", value: i.matchedOrder ? <span className="inline-flex items-center gap-2">{link(`/admin/orders/${i.matchedOrder.id}`, i.matchedOrder.reference)}<StatusBadge status={i.matchedOrder.status} /></span> : "Not matched" }, { label: "Import file", value: `${i.importBatch.originalFileName} (${fmtDate(i.importBatch.createdAt)}${i.importBatch.uploadedBy ? ` by ${i.importBatch.uploadedBy.name}` : ""})` }, { label: "Line match status", value: Object.entries(lineStatusCounts).map(([k, v]) => `${v} ${humanize(k).toLowerCase()}`).join(", ") || "—" },
            { label: "Reconciliation notes", value: <span className="whitespace-pre-wrap">{i.reconciliationNotes ?? "—"}</span> }, { label: "Imported", value: fmtDateTime(i.createdAt) }, { label: "Demo data", value: i.isDemo ? "Yes" : "No" },
          ]} /></Panel>
        </div>
      ) : null}
      {tab === "lines" ? <Panel title="Invoice lines" flush><MiniTable empty="No lines." head={["#", "Item", "Quantity", "Unit price", "Discount", "Line total", "Match", "Matched to"]} rows={i.lines.map((l) => [l.lineNumber, <div key="i">{l.sapItemDescription}<div className="text-xs text-[#849087]">{l.sapItemCode}</div></div>, `${l.quantityInvoiced.toString()} ${l.unitOfMeasure ?? ""}`, l.unitPrice?.toString() ?? "—", l.discount?.toString() ?? "—", l.lineTotal?.toString() ?? "—", <div key="m"><StatusBadge status={l.matchStatus} />{l.matchMethod ? <div className="text-xs text-[#849087]">{humanize(l.matchMethod)}</div> : null}</div>, l.matchedOrder ? <span key="o">{link(`/admin/orders/${l.matchedOrder.id}`, l.matchedOrder.reference)}{l.matchedOrderLine ? ` line ${l.matchedOrderLine.lineNumber}` : ""}{l.matchedBy ? <span className="block text-xs text-[#849087]">by {l.matchedBy.name}{l.matchedAt ? ` · ${fmtDate(l.matchedAt)}` : ""}</span> : null}</span> : l.matchNote ?? "—"])} /></Panel> : null}
      {tab === "claims" ? (
        <div className="space-y-4">
          <Panel title="Claims" flush><MiniTable empty="No claims against this invoice." head={["Claim", "Category", "Status"]} rows={i.claims.map((c) => [link(`/admin/claims/${c.id}`, c.claimReference), humanize(c.category), <StatusBadge key="s" status={c.status} />])} /></Panel>
          <Panel title="Credit notes" flush><MiniTable empty="No credit notes issued against this invoice." head={["Credit note", "Amount", "Match", "Date"]} rows={i.creditNotes.map((n) => [n.sapCreditNoteDocNum, fmtMoney(n.currencyCode, n.amount), <StatusBadge key="s" status={n.matchStatus} />, fmtDate(n.creditNoteDate)])} /></Panel>
        </div>
      ) : null}
      {tab === "delivery" ? <Panel title="Proof of delivery">{i.deliveryRecord ? <KeyValueGrid items={[{ label: "Outcome", value: <StatusBadge status={i.deliveryRecord.outcome} /> }, { label: "POD reference", value: i.deliveryRecord.podReference ?? "—" }, { label: "Recorded", value: `${fmtDateTime(i.deliveryRecord.recordedAt)}${i.deliveryRecord.recordedBy ? ` by ${i.deliveryRecord.recordedBy.name}` : ""}` }, { label: "Notes", value: i.deliveryRecord.notes ?? "—" }]} /> : <p className="p-4 text-sm text-[#849087]">No proof of delivery is recorded against this invoice.</p>}</Panel> : null}
    </div>
  );
}
