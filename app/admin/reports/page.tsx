import Link from "next/link";
import { PageHeader, Panel } from "../_components/ui";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;

/** Entry points only. The reports themselves are not re-implemented here: one calculation, one source of truth. */
const REPORTS: { group: string; items: { href: string; label: string; description: string }[] }[] = [
  { group: "Sales", items: [
    { href: "/reports/sales-performance", label: "Sales performance", description: "Orders and quotations by salesperson, customer and period." },
    { href: "/reports/pipeline", label: "Pipeline", description: "Open quotations and orders by stage and age." },
    { href: "/reports/customer-intelligence", label: "Customer intelligence", description: "Buying patterns, lapsed and growing customers." },
    { href: "/reports/product-intelligence", label: "Product intelligence", description: "Movement, margin signals and price coverage." },
  ] },
  { group: "Finance & fulfilment", items: [
    { href: "/reports/financial-exposure", label: "Financial exposure", description: "Claim and credit exposure, kept separate by currency." },
    { href: "/reports/fulfilment", label: "Fulfilment", description: "Picking, dispatch and delivery performance." },
    { href: "/invoice-claims/dashboard", label: "Claims dashboard", description: "Claim volumes, resolution and credit exposure." },
    { href: "/lost-sales", label: "Lost sales", description: "Demand that could not be served." },
  ] },
  { group: "Management", items: [
    { href: "/reports/management", label: "Management intelligence", description: "Findings that turn report data into recommendations." },
    { href: "/reports/management/actions", label: "Management actions", description: "Recommended actions, owners and status." },
    { href: "/reports/decision-intelligence", label: "Decision intelligence", description: "Approval and pricing decisions over time." },
    { href: "/reports/communications", label: "Communications", description: "Inbound and outbound message volumes and failures." },
  ] },
];

export default async function AdminReportsPage() {
  await requireAdminPage();
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="The existing reports, grouped for administrators. They are linked, not copied, so every number comes from the same calculation everywhere." />
      {REPORTS.map((g) => (
        <Panel key={g.group} title={g.group}>
          <ul className="grid gap-px bg-[#EEF1ED] sm:grid-cols-2">{g.items.map((i) => <li key={i.href} className="bg-white"><Link href={i.href} className="block px-4 py-3 hover:bg-[#F7F8F6]"><span className="text-sm font-semibold text-[#1F7A4D]">{i.label}</span><span className="mt-0.5 block text-xs text-[#6B7B72]">{i.description}</span></Link></li>)}</ul>
        </Panel>
      ))}
    </div>
  );
}
