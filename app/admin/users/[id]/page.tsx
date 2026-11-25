import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { getUserDetail } from "@/lib/admin/user-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { PageHeader, Panel as SectionCard } from "../../_components/ui";
import { EmptyState } from "../../../reports/_components/ui";
import { requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { ReassignUserDialog } from "../../_components/reassign-user-dialog";
import { PasswordResetDialog } from "../../_components/password-reset-dialog";

export const instant = false;
const DEPARTMENTS = ["PURCHASING", "WAREHOUSE", "QUALITY_CONTROL", "SALES", "FINANCE", "OPERATIONS", "MANAGEMENT"];

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const { user, lastLoginAt, activeSessions, workload, audit } = detail;
  const assignees = (await listActiveAssignees()).filter((a) => a.id !== id);
  const isSelf = actor.id === id;
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "Never");

  return (
    <div className="space-y-4">
      <PageHeader title={user.name} description={`${user.email} · ${user.role.replace("_", " ")}${user.department ? ` · ${user.department.replace("_", " ")}` : ""} · ${user.status}`} actions={<Link href="/admin/users" className="text-sm font-semibold text-[#1F7A4D]">← All users</Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Access">
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <dt className="text-[#849087]">Last sign-in</dt><dd>{fmt(lastLoginAt)}</dd>
            <dt className="text-[#849087]">Active sessions</dt><dd>{activeSessions}</dd>
            <dt className="text-[#849087]">Password change required</dt><dd>{user.mustChangePassword ? "Yes" : "No"}</dd>
            <dt className="text-[#849087]">Created</dt><dd>{fmt(user.createdAt)}</dd>
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-[#EEF1ED] p-4">
            <ActionDialog label="Change role" title="Change role" description="The user is signed out so the new permissions apply immediately." endpoint={`/api/admin/users/${id}`} method="PATCH" confirmLabel="Change role" fields={[{ name: "role", label: "New role", type: "select", defaultValue: user.role, options: [{ value: "SALESPERSON", label: "Salesperson" }, { value: "SALES_MANAGER", label: "Sales Manager" }, { value: "ADMINISTRATOR", label: "Administrator" }] }]} />
            <ActionDialog label="Set department" title="Set department" endpoint={`/api/admin/users/${id}`} method="PATCH" confirmLabel="Save" fields={[{ name: "department", label: "Department", type: "select", defaultValue: user.department ?? "", options: [{ value: "", label: "None" }, ...DEPARTMENTS.map((d) => ({ value: d, label: d.replace("_", " ") }))] }]} />
            <ActionDialog label="Rename" title="Rename user" endpoint={`/api/admin/users/${id}`} method="PATCH" confirmLabel="Save" fields={[{ name: "name", label: "Name", type: "text", defaultValue: user.name }]} />
            {user.status === "ACTIVE" ? <PasswordResetDialog userId={id} /> : null}
            {user.status === "ACTIVE" ? (
              <ActionDialog label={isSelf ? "Deactivate (not allowed for yourself)" : "Deactivate"} variant="danger" destructive title={`Deactivate ${user.name}?`} description="They are signed out immediately and cannot sign in. Their history stays. Reassign their open work first." endpoint={`/api/admin/users/${id}/status`} payload={{ status: "INACTIVE" }} confirmLabel="Deactivate" />
            ) : (
              <ActionDialog label="Reactivate" variant="primary" title={`Reactivate ${user.name}?`} endpoint={`/api/admin/users/${id}/status`} payload={{ status: "ACTIVE" }} confirmLabel="Reactivate" />
            )}
          </div>
        </SectionCard>
        <SectionCard title="Open work owned" description="Reassign before deactivating so nothing is left without an owner.">
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <dt className="text-[#849087]">Open orders</dt><dd>{workload.orders}</dd>
            <dt className="text-[#849087]">Open quotations (draft / issued)</dt><dd>{workload.quotations}</dd>
            <dt className="text-[#849087]">Customers managed</dt><dd>{workload.customers}</dd>
            <dt className="text-[#849087]">Open claims</dt><dd>{workload.claims}</dd>
            <dt className="text-[#849087]">Open management actions</dt><dd>{workload.managementActions}</dd>
          </dl>
          <div className="border-t border-[#EEF1ED] p-4">
            {workload.total === 0 ? <p className="text-sm text-[#5F6F66]">Nothing to reassign.</p> : <ReassignUserDialog fromUserId={id} assignees={assignees.map((a) => ({ id: a.id, name: a.name }))} />}
          </div>
        </SectionCard>
      </div>
      <SectionCard title="Recent activity" description="Actions by this user and changes made to this user.">
        {audit.length === 0 ? <EmptyState message="No recorded activity." /> : (
          <ul className="divide-y divide-[#EEF1ED] text-sm">{audit.map((e) => <li key={e.id} className="flex justify-between gap-3 px-4 py-2"><span>{e.action.replace(/_/g, " ").toLowerCase()} <span className="text-[#849087]">· {e.entityType}</span></span><span className="shrink-0 text-xs text-[#849087]">{e.actor?.name ?? "System"} · {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span></li>)}</ul>
        )}
      </SectionCard>
    </div>
  );
}
