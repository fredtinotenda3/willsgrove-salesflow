import Link from "next/link";
import { PageHeader, SectionCard } from "../../reports/_components/ui";
import { DownloadButton } from "../_components/download-button";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";

export const instant = false;

const IMPORTS = [
  { href: "/products/import", title: "Products (catalogue import)", text: "CSV/Excel import with preview, duplicate detection and row-level errors before anything is written." },
  { href: "/item-master/import", title: "Item master (SAP)", text: "SAP item-master import with preview and row-level validation." },
  { href: "/customers/master-import", title: "Customers (SAP customer master)", text: "Preview, validation and a failed-row report before confirming." },
  { href: "/price-lists/import", title: "Price lists", text: "SAP price-list CSV/Excel with preview; historical transaction prices are never rewritten." },
  { href: "/tax-codes/import", title: "Tax codes", text: "Tax-code import with preview." },
  { href: "/returns-credits/import", title: "Credit notes & returns", text: "Credit-note import with preview, import history and matching." },
  { href: "/invoice-reconciliation/import", title: "SAP invoices", text: "Invoice import with import history." },
];
const EXPORTS = [
  { href: "/api/admin/products/export", title: "Products (CSV)" },
  { href: "/api/admin/products/export?template=1", title: "Product template (CSV headers)" },
  { href: "/api/admin/customers/export", title: "Customers (CSV)" },
  { href: "/api/admin/users/export", title: "Users (CSV, no credentials)" },
  { href: "/api/admin/audit/export", title: "Audit log (CSV, latest 5,000)" },
];

export default async function AdminDataPage() {
  await requireAdminPage();
  return (
    <AdminShell active="/admin/data">
      <PageHeader breadcrumb="Workspace / Administration / Data management" title="Imports & exports" description="Imports use the existing, tested import screens (preview, validation, row-level errors, confirmation, import history). Exports are recorded in the audit log." />
      <SectionCard title="Exports">
        <ul className="divide-y divide-[#EEF1ED]">{EXPORTS.map((e) => <li key={e.href} className="flex items-center justify-between px-4 py-3 text-sm"><span>{e.title}</span><DownloadButton href={e.href} className="text-xs font-semibold text-[#1F7A4D]">Download</DownloadButton></li>)}</ul>
      </SectionCard>
      <SectionCard title="Imports">
        <ul className="divide-y divide-[#EEF1ED]">{IMPORTS.map((i) => <li key={i.href}><Link href={i.href} className="block px-4 py-3 text-sm hover:bg-[#F7F8F6]"><span className="font-semibold">{i.title}</span><span className="block text-xs text-[#5F6F66]">{i.text}</span></Link></li>)}</ul>
      </SectionCard>
    </AdminShell>
  );
}
