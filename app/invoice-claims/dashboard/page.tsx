import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getInvoiceClaimsDashboard } from "@/lib/invoice-claims/dashboard";
import { CLAIM_STATUS_LABELS, CLAIM_CATEGORY_LABELS } from "@/lib/invoice-claims/display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft } from "lucide-react";

/**
 * Milestone 6A. Claims dashboard (spec section 8): counts by status/
 * category, top customers and departments, products with recurring
 * quality problems, financial exposure by currency, average resolution
 * time, repeat complaints. Every bucket drills down by linking to
 * /invoice-claims with the matching filter.
 */
export const instant = false;

export default async function InvoiceClaimsDashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const dashboard = await getInvoiceClaimsDashboard({});

  const statusEntries = Object.entries(dashboard.statusCounts).filter(([, count]) => count > 0);
  const categoryEntries = Object.entries(dashboard.categoryCounts).filter(([, count]) => count > 0);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Claims / Dashboard</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Claims Dashboard</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/invoice-claims" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to claims queue
          </Link>

          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {statusEntries.map(([status, count]) => (
              <Link
                key={status}
                href={`/invoice-claims?status=${status}`}
                className="rounded-xl border border-[#E8EBE6] bg-white p-4 transition hover:border-[#173D2E]/30"
              >
                <p className="text-2xl font-bold text-[#17251E]">{count}</p>
                <p className="mt-1 text-[11px] text-gray-500">{CLAIM_STATUS_LABELS[status] ?? status}</p>
              </Link>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">By category</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {categoryEntries.map(([category, count]) => (
                  <li key={category} className="flex justify-between">
                    <span className="text-gray-600">{CLAIM_CATEGORY_LABELS[category] ?? category}</span>
                    <span className="font-semibold text-gray-700">{count}</span>
                  </li>
                ))}
                {categoryEntries.length === 0 && <li className="text-gray-400">No claims yet.</li>}
              </ul>
            </div>

            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Top customers by claim volume</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {dashboard.byCustomer.slice(0, 10).map((row) => (
                  <li key={row.customerId} className="flex justify-between">
                    <Link href={`/invoice-claims?customerId=${row.customerId}`} className="text-gray-600 hover:underline">{row.customerName}</Link>
                    <span className="font-semibold text-gray-700">{row.claimCount}</span>
                  </li>
                ))}
                {dashboard.byCustomer.length === 0 && <li className="text-gray-400">No claims yet.</li>}
              </ul>
            </div>

            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Products with recurring quality problems</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {dashboard.byProduct.slice(0, 10).map((row) => (
                  <li key={row.sapItemCode} className="flex justify-between">
                    <span className="text-gray-600">{row.sapItemCode} {row.sapItemDescription ? `-- ${row.sapItemDescription}` : ""}</span>
                    <span className="font-semibold text-gray-700">{row.claimLineCount} claim lines ({row.qualityIssueCount} quality)</span>
                  </li>
                ))}
                {dashboard.byProduct.length === 0 && <li className="text-gray-400">No disputed lines yet.</li>}
              </ul>
            </div>

            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Responsible departments</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {dashboard.byResponsibleDepartment.map((row) => (
                  <li key={row.department} className="flex justify-between">
                    <span className="text-gray-600">{row.department}</span>
                    <span className="font-semibold text-gray-700">{row.claimCount}</span>
                  </li>
                ))}
                {dashboard.byResponsibleDepartment.length === 0 && <li className="text-gray-400">No resolution has named a responsible department yet.</li>}
              </ul>
            </div>
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h3 className="text-sm font-bold text-[#17251E]">Financial exposure by currency</h3>
            <p className="mt-1 text-[11px] text-gray-400">Pending estimates, never converted between currencies. Actual SAP-credited amounts are reconciled in Milestone 6B.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="py-2 pr-4 font-semibold uppercase tracking-wider">Currency</th>
                    <th className="py-2 pr-4 text-right font-semibold uppercase tracking-wider">Claims</th>
                    <th className="py-2 pr-4 text-right font-semibold uppercase tracking-wider">Potential credit exposure</th>
                    <th className="py-2 pr-4 text-right font-semibold uppercase tracking-wider">Approved credit exposure</th>
                    <th className="py-2 text-right font-semibold uppercase tracking-wider">Actual SAP credited</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.exposureByCurrency.map((row) => (
                    <tr key={row.currencyCode} className="border-t border-gray-100">
                      <td className="py-2 pr-4 font-semibold text-gray-700">{row.currencyCode}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{row.claimCount}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{row.potentialCreditExposure}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{row.approvedCreditExposure}</td>
                      <td className="py-2 text-right text-gray-400">Pending 6B</td>
                    </tr>
                  ))}
                  {dashboard.exposureByCurrency.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-gray-400">No claims yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Average resolution time</h3>
              <p className="mt-2 text-2xl font-bold text-[#17251E]">
                {dashboard.averageResolutionDays !== null ? `${dashboard.averageResolutionDays.toFixed(1)} days` : "No concluded claims yet"}
              </p>
            </div>
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Repeat complaints</h3>
              {dashboard.repeatComplaintCustomers.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">No customer has filed more than one claim yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-xs">
                  {dashboard.repeatComplaintCustomers.slice(0, 10).map((row) => (
                    <li key={row.customerId} className="flex justify-between">
                      <Link href={`/invoice-claims?customerId=${row.customerId}`} className="text-gray-600 hover:underline">{row.customerName}</Link>
                      <span className="font-semibold text-gray-700">{row.claimCount} claims</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
