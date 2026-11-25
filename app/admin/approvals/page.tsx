import Link from "next/link";
import { fmtDate, fmtDateTime, humanize } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { APPROVAL_SORT_KEYS, listAdminApprovalPolicies, listAdminApprovals } from "@/lib/admin/ops-admin";
import { Notice, Panel, Tabs } from "../_components/ui";

type Row = Awaited<ReturnType<typeof listAdminApprovals>>["rows"][number];

export default async function AdminApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "module", "tab"], sortKeys: APPROVAL_SORT_KEYS, fallbackSort: { key: "submitted", dir: "desc" } });
  const tab = list.get("tab") === "policies" ? "policies" : "requests";
  const [{ total, rows }, policies] = await Promise.all([
    tab === "requests" ? listAdminApprovals({ q: list.q, status: list.get("status"), module: list.get("module"), from: list.from, to: list.to }, list.page, list.pageSize, list.sort) : Promise.resolve({ total: 0, rows: [] as Row[] }),
    tab === "policies" ? listAdminApprovalPolicies() : Promise.resolve([]),
  ]);
  const columns: Column<Row>[] = [
    { key: "subject", header: "Subject", render: (a) => a.quotation ? <Link href={`/admin/quotations/${a.quotation.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{a.quotation.quotationNumber}</Link> : a.customerOrder ? <Link href={`/admin/orders/${a.customerOrder.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{a.customerOrder.reference}</Link> : "—" },
    { key: "module", header: "Module", sortKey: "module", hideBelow: "md", render: (a) => humanize(a.module) },
    { key: "action", header: "Rule", hideBelow: "lg", render: (a) => humanize(a.actionType) },
    { key: "status", header: "Status", sortKey: "status", render: (a) => <StatusBadge status={a.status} /> },
    { key: "approver", header: "Required approver", hideBelow: "lg", render: (a) => humanize(a.requiredApproverRole) },
    { key: "requestedBy", header: "Requested by", hideBelow: "md", render: (a) => a.requestedBy?.name ?? "—" },
    { key: "submitted", header: "Submitted", sortKey: "submitted", hideBelow: "md", render: (a) => fmtDateTime(a.submittedAt) },
    { key: "decided", header: "Decision", sortKey: "decided", hideBelow: "lg", render: (a) => (a.decidedAt ? <>{fmtDateTime(a.decidedAt)}<div className="text-xs text-[#849087]">{a.decidedBy?.name}{a.decisionReason ? ` — ${a.decisionReason}` : ""}</div></> : "—") },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Approvals" description="Approval requests and the policies that create them. Decisions are made by the required approver in the approvals queue — an administrator cannot approve on someone else's behalf here, which keeps the segregation of duties intact." actions={<Link href="/approvals" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open approvals queue</Link>} />
      <Tabs basePath="/admin/approvals" active={tab} tabs={[{ key: "requests", label: "Requests" }, { key: "policies", label: "Policies" }]} params={{}} />
      {tab === "requests" ? (
        <>
          <TableToolbar tableId="admin-approvals" searchPlaceholder="Quotation, order or requester" exportHref={`/api/admin/export/approvals?${new URLSearchParams(list.params)}`}
            filters={[{ name: "status", label: "Status", options: opts(["PENDING", "APPROVED", "REJECTED"]) }, { name: "module", label: "Module", options: opts(["QUOTATIONS", "ORDERS"]) }]} columns={columns.map((c) => ({ key: c.key, label: c.header }))}>
            <DateRangeFilter action="/admin/approvals" params={list.params} />
          </TableToolbar>
          <DataTable id="admin-approvals" columns={columns} rows={rows} rowId={(a) => a.id} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/approvals" params={list.params} sort={list.sort} rowActions={(a) => <Link href={`/approvals/${a.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Open</Link>} />
        </>
      ) : (
        <Panel title="Approval policies" description="Policies are edited on the approval policies screen, where changes are versioned by effective date. Policies in use are deactivated, not deleted." actions={<Link href="/approvals/policies" className="text-xs font-semibold text-[#1F7A4D]">Manage policies →</Link>} flush>
          {policies.length === 0 ? <Notice tone="info">No approval policies are defined.</Notice> : (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Policy</th><th className="px-4 py-2">Module</th><th className="px-4 py-2">Rule</th><th className="px-4 py-2">Threshold</th><th className="px-4 py-2">Approver</th><th className="px-4 py-2">Effective</th><th className="px-4 py-2">Requests</th><th className="px-4 py-2">Status</th></tr></thead>
              <tbody>{policies.map((p) => <tr key={p.id} className="border-t border-[#EEF1ED]"><td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2">{humanize(p.module)}</td><td className="px-4 py-2">{humanize(p.actionType)}</td><td className="px-4 py-2">{p.thresholdPercent ? `${p.thresholdPercent.toString()}%` : p.thresholdAmount ? `${p.currency ?? ""} ${p.thresholdAmount.toString()}` : "—"}</td><td className="px-4 py-2">{humanize(p.requiredApproverRole)}{p.allowRequesterSelfApprove ? " (self-approval allowed)" : ""}</td><td className="px-4 py-2">{fmtDate(p.effectiveFrom)}{p.effectiveTo ? ` – ${fmtDate(p.effectiveTo)}` : ""}</td><td className="px-4 py-2">{p._count.requests}</td><td className="px-4 py-2"><StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} /></td></tr>)}</tbody></table></div>
          )}
        </Panel>
      )}
    </div>
  );
}
