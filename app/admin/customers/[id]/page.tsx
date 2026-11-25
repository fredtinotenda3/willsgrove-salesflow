import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDate, fmtDateTime, fmtMoney, humanize } from "@/lib/admin/format";
import { KeyValueGrid, PageHeader, Panel, Stat, Tabs } from "../../_components/ui";
import { AuditTrail, DeleteSection, MiniTable } from "../../_components/detail-parts";
import { requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { StatusBadge, userOptions } from "../../_components/status-badge";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { getAdminCustomerDetail } from "@/lib/admin/customer-admin";

export const instant = false;
const link = (href: string, text: string) => <Link href={href} className="text-[#1F7A4D] hover:underline">{text}</Link>;
const tabOf = (raw: string | undefined, allowed: string[]) => (raw && allowed.includes(raw) ? raw : allowed[0]);


const TABS = ["overview", "contacts", "locations", "orders", "quotations", "finance", "aliases", "activity", "actions"];
const customerFields = (c: { name: string; sapCustomerCode: string | null; email: string | null; phone: string | null; category: string | null; notes: string | null }) => [
  { name: "name", label: "Customer name", type: "text" as const, required: true, defaultValue: c.name },
  { name: "sapCustomerCode", label: "SAP customer code", type: "text" as const, defaultValue: c.sapCustomerCode ?? "" },
  { name: "email", label: "Email", type: "text" as const, defaultValue: c.email ?? "" },
  { name: "phone", label: "Phone", type: "text" as const, defaultValue: c.phone ?? "" },
  { name: "category", label: "Category", type: "text" as const, defaultValue: c.category ?? "" },
  { name: "notes", label: "Notes", type: "textarea" as const, defaultValue: c.notes ?? "" },
];
const contactFields = (c?: { name: string; role: string | null; email: string | null; phone: string | null }) => [
  { name: "name", label: "Name", type: "text" as const, required: true, defaultValue: c?.name },
  { name: "role", label: "Role", type: "text" as const, defaultValue: c?.role ?? "" },
  { name: "email", label: "Email", type: "text" as const, defaultValue: c?.email ?? "" },
  { name: "phone", label: "Phone", type: "text" as const, defaultValue: c?.phone ?? "" },
];

export default async function AdminCustomerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const d = await getAdminCustomerDetail(id);
  if (!d) notFound();
  const { customer: c, orders, quotations, invoices, claims, openOrders, history, invoiceTotals, canDelete } = d;
  const tab = tabOf(one((await searchParams).tab), TABS);
  const assignees = tab === "actions" ? await listActiveAssignees() : [];
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/customers", label: "All customers" }} title={c.name} description={`${c.sapCustomerCode ?? "No SAP code"} · ${c.accountManager ? `Account manager ${c.accountManager.name}` : "No account manager"}`} actions={<><StatusBadge status={c.status} />{c.creditHold ? <StatusBadge status="REJECTED" className="!bg-red-50" /> : null}<Link href={`/customers/${c.id}`} className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#F7F8F6]">Open operational view</Link></>} />
      <Tabs basePath={`/admin/customers/${c.id}`} active={tab} tabs={[{ key: "overview", label: "Overview" }, { key: "contacts", label: "Contacts", count: c.contacts.length }, { key: "locations", label: "Locations", count: c.locations.length }, { key: "orders", label: "Orders", count: c._count.orders }, { key: "quotations", label: "Quotations", count: c._count.quotations }, { key: "finance", label: "Invoices & claims" }, { key: "aliases", label: "Aliases", count: c.customerAliases.length }, { key: "activity", label: "Activity" }, { key: "actions", label: "Actions" }]} />
      {tab === "overview" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Open orders" value={String(openOrders)} href={`/admin/orders?q=${encodeURIComponent(c.name)}&scope=open`} /><Stat label="Orders" value={String(c._count.orders)} /><Stat label="Quotations" value={String(c._count.quotations)} /><Stat label="SAP invoices" value={String(c._count.sapInvoices)} /></div>
          <Panel title="Customer"><KeyValueGrid columns={3} items={[
            { label: "Name", value: c.name }, { label: "SAP code", value: c.sapCustomerCode ?? "—" }, { label: "Category", value: c.category ?? "—" },
            { label: "Email", value: c.email ?? "—" }, { label: "Phone", value: c.phone ?? "—" }, { label: "Currency", value: c.currencyCode ?? "—" },
            { label: "Account manager", value: c.accountManager?.name ?? "—" }, { label: "Price list", value: c.priceList ? link(`/admin/price-lists/${c.priceList.id}`, `${c.priceList.code} (${c.priceList.currencyCode})`) : "None assigned" }, { label: "Payment terms", value: c.paymentTermsCode ?? "—" },
            { label: "TIN", value: c.tin ?? "—" }, { label: "VAT number", value: c.vatNumber ?? "—" }, { label: "Credit", value: `${c.creditLimit ? `Limit ${c.creditLimit}` : "No limit recorded"}${c.creditHold ? " · ON HOLD" : ""}` },
            { label: "Notes", value: <span className="whitespace-pre-wrap">{c.notes ?? "—"}</span> }, { label: "Created", value: fmtDateTime(c.createdAt) }, { label: "Demo data", value: c.isDemo ? "Yes" : "No" },
          ]} /></Panel>
        </div>
      ) : null}
      {tab === "contacts" ? <Panel title="Contacts" actions={<ActionDialog label="Add contact" variant="primary" title="Add contact" endpoint={`/api/admin/customers/${c.id}/contacts`} confirmLabel="Add contact" fields={contactFields()} />} flush><MiniTable empty="No contacts recorded." head={["Name", "Role", "Email", "Phone", ""]} rows={c.contacts.map((p) => [p.name, p.role ?? "—", p.email ?? "—", p.phone ?? "—", <div key="a" className="flex gap-1.5"><ActionDialog label="Edit" title={`Edit ${p.name}`} endpoint={`/api/admin/customers/${c.id}/contacts/${p.id}`} method="PATCH" confirmLabel="Save" fields={contactFields(p)} /><ActionDialog label="Remove" variant="danger" destructive title={`Remove ${p.name}?`} description="Contacts that appear on quotations or messages are kept; you will be told if so." endpoint={`/api/admin/customers/${c.id}/contacts/${p.id}`} method="DELETE" confirmLabel="Remove" /></div>])} /></Panel> : null}
      {tab === "locations" ? <Panel title="Delivery locations" description="Locations are managed in the operational customer view, where default and delivery-address rules are enforced." actions={<Link href={`/customers/${c.id}`} className="text-xs font-semibold text-[#1F7A4D]">Manage locations →</Link>} flush><MiniTable empty="No locations recorded." head={["Label", "Address", "City", "Province", "Default", "Active"]} rows={c.locations.map((l) => [l.label, [l.addressLine1, l.addressLine2].filter(Boolean).join(", "), l.city ?? "—", l.province ?? "—", l.isDefault ? "Yes" : "", <StatusBadge key="s" status={l.isActive ? "ACTIVE" : "INACTIVE"} />])} /></Panel> : null}
      {tab === "orders" ? <Panel title="Recent orders" actions={<Link href={`/admin/orders?q=${encodeURIComponent(c.name)}`} className="text-xs font-semibold text-[#1F7A4D]">All orders →</Link>} flush><MiniTable empty="No orders." head={["Order", "Status", "Total", "Created"]} rows={orders.map((o) => [link(`/admin/orders/${o.id}`, o.reference), <StatusBadge key="s" status={o.status} />, o.total ? fmtMoney(o.currency, o.total) : "—", fmtDate(o.createdAt)])} /></Panel> : null}
      {tab === "quotations" ? <Panel title="Recent quotations" actions={<Link href={`/admin/quotations?q=${encodeURIComponent(c.name)}`} className="text-xs font-semibold text-[#1F7A4D]">All quotations →</Link>} flush><MiniTable empty="No quotations." head={["Quotation", "Status", "Total", "Created"]} rows={quotations.map((q) => [link(`/admin/quotations/${q.id}`, q.quotationNumber), <StatusBadge key="s" status={q.status} />, fmtMoney(q.currency, q.total), fmtDate(q.createdAt)])} /></Panel> : null}
      {tab === "finance" ? (
        <div className="space-y-4">
          <Panel title="Invoiced value by currency" description="Cancelled and reversed documents are excluded. Currencies are never combined."><MiniTable empty="No SAP invoices matched to this customer." head={["Currency", "Invoices", "Total"]} rows={invoiceTotals.map((t) => [t.currencyCode, t.count, fmtMoney(t.currencyCode, t.total)])} /></Panel>
          <Panel title="Recent SAP invoices" flush><MiniTable empty="None." head={["Invoice", "Date", "Total", "Reconciliation"]} rows={invoices.map((i) => [link(`/admin/invoices/${i.id}`, i.sapDocNum), fmtDate(i.invoiceDate), i.total ? fmtMoney(i.currencyCode, i.total) : "—", <StatusBadge key="s" status={i.reconciliationStatus} />])} /></Panel>
          <Panel title="Recent claims" flush><MiniTable empty="No claims." head={["Claim", "Category", "Status", "Date"]} rows={claims.map((x) => [link(`/admin/claims/${x.id}`, x.claimReference), humanize(x.category), <StatusBadge key="s" status={x.status} />, fmtDate(x.claimDate)])} /></Panel>
        </div>
      ) : null}
      {tab === "aliases" ? <Panel title="Learned name aliases" description="Names this customer has been recorded under in inbound messages. Removing one only stops automatic matching." flush><MiniTable empty="No aliases learned." head={["Alias", "Confirmed", "Last confirmed", ""]} rows={c.customerAliases.map((a) => [a.rawText, `${a.timesConfirmed}×`, fmtDate(a.lastConfirmedAt), <ActionDialog key="r" label="Remove" variant="danger" destructive title="Remove this alias?" endpoint={`/api/admin/customers/aliases/${a.id}`} method="DELETE" confirmLabel="Remove alias" />])} /></Panel> : null}
      {tab === "activity" ? <AuditTrail events={history} /> : null}
      {tab === "actions" ? (
        <div className="space-y-4">
          <Panel title="Manage this customer"><div className="flex flex-wrap gap-2 p-4">
            <ActionDialog label="Edit details" title={`Edit ${c.name}`} endpoint={`/api/customers/${c.id}`} method="PATCH" askReason={false} blank="omit" confirmLabel="Save" fields={customerFields(c)} />
            <ActionDialog label={c.accountManager ? "Change account manager" : "Assign account manager"} title="Account manager" endpoint="/api/admin/assignments/reassign" payload={{ entityType: "CUSTOMER", ids: [c.id], confirm: true }} confirmLabel="Save" fields={[{ name: "toUserId", label: "Account manager", type: "select", options: userOptions(assignees), required: true, defaultValue: c.accountManager?.id }]} />
            {c.status === "ACTIVE" ? <ActionDialog label="Deactivate" variant="danger" destructive title={`Deactivate ${c.name}?`} description="Hidden from new orders and quotations. Orders, quotations, invoices and claims are kept." consequences={openOrders ? [`${openOrders} open order(s) remain open and must be completed or cancelled separately.`] : undefined} endpoint={`/api/customers/${c.id}`} method="PATCH" payload={{ status: "INACTIVE" }} askReason={false} confirmLabel="Deactivate" /> : <ActionDialog label="Reactivate" variant="primary" title={`Reactivate ${c.name}?`} endpoint={`/api/customers/${c.id}`} method="PATCH" payload={{ status: "ACTIVE" }} askReason={false} confirmLabel="Reactivate" />}
          </div></Panel>
          <DeleteSection verdict={canDelete} noun="customer" endpoint={`/api/admin/customers/${c.id}`} confirmText={c.name} redirect="/admin/customers" alternative="Deactivate the customer instead. They disappear from new orders and quotations while every historical document keeps its link." lines={[`${c.contacts.length} contact(s), ${c.locations.length} location(s) and ${c.customerAliases.length} alias(es) belonging only to this customer are removed with it.`]} />
        </div>
      ) : null}
    </div>
  );
}
