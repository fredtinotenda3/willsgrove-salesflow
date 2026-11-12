import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MANAGEMENT_REPORT_CATALOGUE } from "@/lib/reporting/management-reports";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard } from "../_components/ui";
import { ArrowRight, FileText, List } from "lucide-react";

/**
 * Milestone 11 (Operational BI), spec section 9: catalogue of the 11
 * named management reports. SALES_MANAGER/ADMINISTRATOR only -- a
 * page-level redirect for SALESPERSON, matching app/approvals/policies/
 * page.tsx's established precedent exactly. This is a UX convenience,
 * never the security boundary: every underlying route
 * (app/api/reports/management/**) enforces the same restriction again,
 * server-side, via lib/reporting/access.ts's requireManagementReportAccess
 * regardless of whether this page is ever reached (spec section 10:
 * "never rely on hiding a UI component as the sole security control").
 */
export const instant = false;

export default async function ManagementReportsCataloguePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") {
    redirect("/reports");
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Management Reports</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Management Reports</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Management Reports"
            title="Management Reports"
            description="Named, exportable reports for sales management -- each backed by the same real M0-M10 data as the operational dashboards, with its own filters and CSV export."
          />

          <SectionCard title="All reports" description={`${MANAGEMENT_REPORT_CATALOGUE.length} named reports`}>
            <div className="divide-y divide-[#EEF1ED]">
              {MANAGEMENT_REPORT_CATALOGUE.map((report) => (
                <Link
                  key={report.id}
                  href={`/reports/management/${report.id}`}
                  className="group flex items-center justify-between gap-4 py-4 transition hover:bg-gray-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F2F6F1] text-[#496A42]">
                      {report.kind === "list" ? <List size={15} /> : <FileText size={15} />}
                    </div>
                    <div>
                      <p className="font-semibold text-[#17251E]">{report.name}</p>
                      <p className="mt-0.5 text-xs text-[#849087]">{report.description}</p>
                    </div>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>
      </main>
    </div>
  );
}
