import Link from "next/link";
import { listAdminUsers, USER_SORTS } from "@/lib/admin/user-admin";
import { fmtDateTime, humanize } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";
import { CreateUserDialog } from "../_components/create-user-dialog";

export const instant = false;
type Row = Awaited<ReturnType<typeof listAdminUsers>>["rows"][number];

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "role", "status", "department", "mustChange"], sortKeys: Object.keys(USER_SORTS), fallbackSort: { key: "name", dir: "asc" } });
  const { total, rows } = await listAdminUsers({ q: list.q, role: list.get("role"), status: list.get("status"), department: list.get("department"), mustChange: list.get("mustChange") === "1" }, list.page, list.pageSize, list.sort);
  const columns: Column<Row>[] = [
    { key: "name", header: "Name", sortKey: "name", render: (u) => <div><Link href={`/admin/users/${u.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{u.name}</Link><div className="text-xs text-[#849087]">{u.email}</div></div> },
    { key: "role", header: "Role", sortKey: "role", render: (u) => humanize(u.role) },
    { key: "department", header: "Department", sortKey: "department", hideBelow: "md", render: (u) => (u.department ? humanize(u.department) : "—") },
    { key: "status", header: "Status", sortKey: "status", render: (u) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={u.status} />{u.mustChangePassword ? <span className="text-xs text-amber-700">password change pending</span> : null}</div> },
    { key: "login", header: "Last login", hideBelow: "lg", render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never") },
    { key: "created", header: "Created", sortKey: "created", hideBelow: "xl", defaultHidden: true, render: (u) => fmtDateTime(u.createdAt) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Users & access" description="Roles are Salesperson, Sales Manager and Administrator. Permissions follow the role; the department is for routing and filtering only. Users are deactivated, never deleted, because orders, approvals and the audit log refer to them." actions={<CreateUserDialog />} />
      <TableToolbar tableId="admin-users" searchPlaceholder="Name or email" exportHref="/api/admin/users/export"
        filters={[{ name: "role", label: "Role", options: opts(["SALESPERSON", "SALES_MANAGER", "ADMINISTRATOR"]) }, { name: "status", label: "Status", options: opts(["ACTIVE", "INACTIVE"]) }, { name: "department", label: "Department", options: opts(["PURCHASING", "WAREHOUSE", "QUALITY_CONTROL", "SALES", "FINANCE", "OPERATIONS", "MANAGEMENT"]) }]}
        columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))} />
      {list.get("mustChange") === "1" ? <p className="text-xs text-[#5E6B63]">Showing: <strong>active users who have not yet replaced a temporary password</strong> · <Link href="/admin/users" className="font-semibold text-[#1F7A4D]">clear</Link></p> : null}
      <DataTable id="admin-users" columns={columns} rows={rows} rowId={(u) => u.id} rowLabel={(u) => u.name} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/users" params={list.params} sort={list.sort}
        rowActions={(u) => <Link href={`/admin/users/${u.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Manage</Link>} />
    </div>
  );
}
