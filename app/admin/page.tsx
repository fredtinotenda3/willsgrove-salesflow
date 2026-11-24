import Link from "next/link";
import { getAdminOverview } from "@/lib/admin/overview";
import { MetricCard, PageHeader, SectionCard, EmptyState } from "../reports/_components/ui";
import { AdminShell, requireAdminPage } from "./_components/admin-shell";

export const instant = false;

function Tile({ title, value, description, href }: { title: string; value: number; description: string; href: string }) {
  return (
    <Link href={href} className="block rounded-xl transition hover:ring-2 hover:ring-[#1F7A4D]/30">
      <MetricCard title={title} value={String(value)} description={description} />
    </Link>
  );
}

/** Administration Centre. Counts the things an administrator must act on; the analysis lives in Reports, not here. */
export default async function AdminOverviewPage() {
  await requireAdminPage();
  const o = await getAdminOverview();
  const attention = [
    o.orders.withoutSalesperson > 0 && { text: `${o.orders.withoutSalesperson} open order(s) have no salesperson`, href: "/admin/assignments?type=ORDER&scope=unassigned" },
    o.orders.stuck > 0 && { text: `${o.orders.stuck} open order(s) idle for ${o.orders.stuckDays}+ days`, href: "/admin/assignments?type=ORDER&scope=stuck" },
    o.claims.unassigned > 0 && { text: `${o.claims.unassigned} open claim(s) have no owner`, href: "/admin/assignments?type=CLAIM&scope=unassigned" },
    o.managementActions.unassigned > 0 && { text: `${o.managementActions.unassigned} management action(s) are unassigned`, href: "/admin/assignments?type=MANAGEMENT_ACTION&scope=unassigned" },
    o.customers.withoutManager > 0 && { text: `${o.customers.withoutManager} active customer(s) have no account manager`, href: "/admin/assignments?type=CUSTOMER&scope=unassigned" },
    o.users.mustChangePassword > 0 && { text: `${o.users.mustChangePassword} active user(s) have not yet changed a temporary password`, href: "/admin/users" },
    o.users.administrators < 2 && { text: `Only ${o.users.administrators} active administrator — consider adding a second for continuity`, href: "/admin/users" },
  ].filter(Boolean) as { text: string; href: string }[];

  return (
    <AdminShell active="/admin">
      <PageHeader breadcrumb="Workspace / Administration" title="Administration Centre" description="Run users, catalogue, pricing, assignments and configuration from one place. Reporting and analysis stay in Reports." />
      <SectionCard title="Needs attention" description="Operational items that have no owner, or have gone quiet.">
        {attention.length === 0 ? <EmptyState message="Nothing needs administrator attention right now." /> : (
          <ul className="divide-y divide-[#EEF1ED]">
            {attention.map((a) => <li key={a.text}><Link href={a.href} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-[#F7F8F6]"><span>{a.text}</span><span className="text-xs font-semibold text-[#1F7A4D]">Open →</span></Link></li>)}
          </ul>
        )}
      </SectionCard>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile title="Active users" value={o.users.active} description={`${o.users.inactive} inactive · ${o.users.administrators} administrator(s)`} href="/admin/users" />
        <Tile title="Active customers" value={o.customers.active} description={`${o.customers.inactive} inactive`} href="/admin/customers" />
        <Tile title="Active products" value={o.products.active} description={`${o.products.inactive} archived`} href="/admin/products" />
        <Tile title="Active price lists" value={o.priceLists.active} description={`${o.priceLists.inactive} inactive`} href="/admin/price-lists" />
        <Tile title="Outstanding orders" value={o.orders.outstanding} description={`${o.orders.withoutSalesperson} unassigned · ${o.orders.stuck} idle ${o.orders.stuckDays}+ days`} href="/admin/assignments?type=ORDER&scope=all-open" />
        <Tile title="Open claims" value={o.claims.open} description={`${o.claims.unassigned} without an owner`} href="/admin/assignments?type=CLAIM&scope=all-open" />
        <Tile title="Pending approvals" value={o.approvals.pending} description="Awaiting an approver" href="/approvals" />
        <Tile title="Open management actions" value={o.managementActions.open} description={`${o.managementActions.unassigned} unassigned`} href="/reports/management/actions" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Configuration status" description="Business settings that differ from the built-in defaults.">
          <p className="p-4 text-sm">{o.configuration.overridden === 0 ? `All ${o.configuration.total} settings use their defaults.` : `${o.configuration.overridden} of ${o.configuration.total} settings have been changed.`} <Link href="/admin/configuration" className="font-semibold text-[#1F7A4D]">Review →</Link></p>
        </SectionCard>
        <SectionCard title="Recent administrative activity">
          {o.recentActivity.length === 0 ? <EmptyState message="No administrative changes recorded yet." /> : (
            <ul className="divide-y divide-[#EEF1ED] text-sm">
              {o.recentActivity.map((e) => <li key={e.id} className="flex justify-between gap-3 px-4 py-2"><span>{e.action.replace(/_/g, " ").toLowerCase()} <span className="text-[#849087]">· {e.entityType}</span></span><span className="shrink-0 text-xs text-[#849087]">{e.actor?.name ?? "System"} · {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span></li>)}
            </ul>
          )}
          <div className="px-4 pb-3"><Link href="/admin/audit" className="text-xs font-semibold text-[#1F7A4D]">Open the audit log →</Link></div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}
