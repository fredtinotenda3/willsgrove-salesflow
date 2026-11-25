import Link from "next/link";
import { fmtDate, fmtDateTime, humanize } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { KeyValueGrid, Notice, PageHeader, Panel, Stat, Tabs } from "../_components/ui";
import { opts, parseListParams } from "../_components/list-helpers";
import { ActionDialog } from "../_components/action-dialog";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { getIntegrationConnection, integrationHealth, listOperations, listSyncJobs } from "@/lib/admin/ops-admin";

const SYNC_SLUGS: { slug: string; label: string }[] = [{ slug: "products", label: "Products" }, { slug: "customers", label: "Customers" }, { slug: "invoices", label: "Invoices" }, { slug: "credit-notes", label: "Credit notes" }];

export default async function AdminIntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["status", "tab"], sortKeys: [], fallbackSort: { key: "created", dir: "desc" } });
  const tab = list.get("tab") === "operations" ? "operations" : "jobs";
  const [conn, health, jobs, ops] = await Promise.all([
    getIntegrationConnection(), integrationHealth(),
    tab === "jobs" ? listSyncJobs({ status: list.get("status") }, list.page, list.pageSize) : Promise.resolve({ total: 0, rows: [] }),
    tab === "operations" ? listOperations({ status: list.get("status") }, list.page, list.pageSize) : Promise.resolve({ total: 0, rows: [] }),
  ]);
  type J = (typeof jobs.rows)[number];
  type O = (typeof ops.rows)[number];
  const jobCols: Column<J>[] = [
    { key: "type", header: "Job", render: (j) => humanize(j.jobType) },
    { key: "status", header: "Status", render: (j) => <StatusBadge status={j.status} /> },
    { key: "trigger", header: "Trigger", hideBelow: "md", render: (j) => <>{humanize(j.trigger)}{j.triggeredBy ? <div className="text-xs text-[#849087]">{j.triggeredBy.name}</div> : null}</> },
    { key: "started", header: "Started", hideBelow: "md", render: (j) => (j.startedAt ? fmtDateTime(j.startedAt) : "—") },
    { key: "completed", header: "Completed", hideBelow: "lg", render: (j) => (j.completedAt ? fmtDateTime(j.completedAt) : "—") },
    { key: "error", header: "Detail", hideBelow: "lg", render: (j) => (j.errorMessage ? <span className="text-red-700">{j.errorMessage.slice(0, 120)}</span> : j.summary ? <span className="text-xs text-[#5E6B63]">{JSON.stringify(j.summary).slice(0, 120)}</span> : "—") },
  ];
  const opCols: Column<O>[] = [
    { key: "order", header: "Order", render: (o) => <Link href={`/admin/orders/${o.customerOrder.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{o.customerOrder.reference}</Link> },
    { key: "customer", header: "Customer", hideBelow: "md", render: (o) => o.customerOrder.customer.name },
    { key: "status", header: "Status", render: (o) => <StatusBadge status={o.status} /> },
    { key: "attempts", header: "Attempts", align: "right", hideBelow: "md", render: (o) => o.attemptCount },
    { key: "doc", header: "SAP document", hideBelow: "lg", render: (o) => o.externalDocNum ?? "—" },
    { key: "error", header: "Last error", hideBelow: "lg", render: (o) => (o.lastErrorMessage ? <span className="text-red-700">{humanize(o.lastErrorCategory)}: {o.lastErrorMessage.slice(0, 100)}</span> : "—") },
    { key: "updated", header: "Updated", hideBelow: "md", render: (o) => fmtDateTime(o.updatedAt) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="SAP integration" description="Connection health, sync jobs and sales-order submissions. Credentials live in the server environment and are never shown or stored here." actions={<Link href="/integrations/sap" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open SAP console</Link>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Connection" value={conn ? (conn.enabled ? (conn.lastTestOk === false ? "Test failed" : "Enabled") : "Disabled") : "Not configured"} tone={conn?.enabled && conn.lastTestOk !== false ? "good" : "warn"} hint={conn?.lastTestedAt ? `tested ${fmtDate(conn.lastTestedAt)}` : "never tested"} />
        <Stat label="Failed / partial sync jobs" value={String(health.failedJobs)} tone={health.failedJobs ? "bad" : "good"} href="/admin/integrations?status=FAILED" />
        <Stat label="Failed submissions" value={String(health.failedOps)} tone={health.failedOps ? "bad" : "good"} href="/admin/integrations?tab=operations&status=FAILED" />
        <Stat label="Uncertain submissions" value={String(health.uncertainOps)} tone={health.uncertainOps ? "bad" : "good"} hint="Reconcile with SAP before retry" href="/admin/integrations?tab=operations&status=UNCERTAIN" />
      </div>
      {conn ? <Panel title="Connection"><KeyValueGrid columns={3} items={[{ label: "Provider", value: conn.provider }, { label: "Mode", value: humanize(conn.mode) }, { label: "Company DB", value: conn.companyDb ?? "—" }, { label: "Endpoint", value: conn.baseUrl ?? "—" }, { label: "Service user", value: conn.username ?? "—" }, { label: "Last test", value: conn.lastTestedAt ? `${fmtDateTime(conn.lastTestedAt)} — ${conn.lastTestOk ? "passed" : "failed"}${conn.lastTestMessage ? ` (${conn.lastTestMessage})` : ""}` : "Never" }]} /></Panel> : <Notice tone="warn">No SAP connection is configured. Configure it in the SAP console.</Notice>}
      <Panel title="Run a sync" description="Starts the same job the scheduler runs. Imports are idempotent; running one twice does not duplicate data.">
        <div className="flex flex-wrap gap-2 p-4">{SYNC_SLUGS.map((s) => <ActionDialog key={s.slug} label={`Sync ${s.label.toLowerCase()}`} title={`Sync ${s.label.toLowerCase()} from SAP?`} description="Pulls changes from SAP now. It does not alter anything in SAP." endpoint={`/api/integrations/sap/sync/${s.slug}`} askReason={false} confirmLabel="Start sync" successMessage="Sync started." />)}</div>
      </Panel>
      <Tabs basePath="/admin/integrations" active={tab} tabs={[{ key: "jobs", label: "Sync jobs" }, { key: "operations", label: "Order submissions" }]} params={{}} />
      <TableToolbar tableId={`admin-integrations-${tab}`} filters={[{ name: "status", label: "Status", options: opts(tab === "jobs" ? ["PENDING", "RUNNING", "COMPLETED", "FAILED", "PARTIAL"] : ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "UNCERTAIN"]) }]} columns={(tab === "jobs" ? jobCols : opCols).map((c) => ({ key: c.key, label: c.header }))} search={false} />
      {tab === "jobs"
        ? <DataTable id="admin-sync-jobs" columns={jobCols} rows={jobs.rows} rowId={(j) => j.id} total={jobs.total} page={list.page} pageSize={list.pageSize} basePath="/admin/integrations" params={{ ...list.params, tab: "jobs" }} />
        : <DataTable id="admin-sap-ops" columns={opCols} rows={ops.rows} rowId={(o) => o.id} total={ops.total} page={list.page} pageSize={list.pageSize} basePath="/admin/integrations" params={{ ...list.params, tab: "operations" }}
            rowActions={(o) => o.status === "FAILED" ? <ActionDialog label="Retry" title="Retry this SAP submission?" description="Re-sends the sales order to SAP. Only a FAILED submission can be retried; an UNCERTAIN one must first be reconciled in the SAP console so a duplicate document is not created." endpoint={`/api/integrations/sap/operations/${o.id}/retry`} askReason={false} confirmLabel="Retry submission" /> : o.status === "UNCERTAIN" ? <Link href="/integrations/sap" className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold">Reconcile in SAP console</Link> : null} />}
    </div>
  );
}
