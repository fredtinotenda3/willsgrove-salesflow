import Link from "next/link";
import { listAdminUsers } from "@/lib/admin/user-admin";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { CreateUserDialog } from "../_components/create-user-dialog";

export const instant = false;
const DEPARTMENTS = ["PURCHASING", "WAREHOUSE", "QUALITY_CONTROL", "SALES", "FINANCE", "OPERATIONS", "MANAGEMENT"];

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const filters = { q: one(raw.q), role: one(raw.role), status: one(raw.status), department: one(raw.department) };
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const { total, rows } = await listAdminUsers(filters, page, pageSize);
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "Never");
  return (
    <AdminShell active="/admin/users">
      <PageHeader breadcrumb="Workspace / Administration / Users" title="Users & access" description="Roles are Salesperson, Sales Manager and Administrator. Permissions follow the role; the department is for routing and filtering only." actions={<CreateUserDialog />} />
      <form action="/admin/users" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={filters.q ?? ""} placeholder="Name or email" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="role" defaultValue={filters.role ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">All roles</option><option value="SALESPERSON">Salesperson</option><option value="SALES_MANAGER">Sales Manager</option><option value="ADMINISTRATOR">Administrator</option></select>
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
        <select name="department" defaultValue={filters.department ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any department</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d.replace("_", " ")}</option>)}</select>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Users (${total})`}>
        {rows.length === 0 ? <EmptyState message="No users match these filters." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Department</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Last login</th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2"><Link href={`/admin/users/${u.id}`} className="font-medium text-[#1F7A4D] hover:underline">{u.name}</Link><div className="text-xs text-[#849087]">{u.email}</div></td>
                <td className="px-4 py-2">{u.role.replace("_", " ")}</td>
                <td className="px-4 py-2">{u.department ? u.department.replace("_", " ") : "—"}</td>
                <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${u.status === "ACTIVE" ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-600"}`}>{u.status}</span>{u.mustChangePassword ? <span className="ml-2 text-xs text-amber-700">password change pending</span> : null}</td>
                <td className="px-4 py-2 text-xs text-[#5F6F66]">{fmt(u.lastLoginAt)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        <Pagination basePath="/admin/users" searchParams={filters} page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} />
      </SectionCard>
    </AdminShell>
  );
}
