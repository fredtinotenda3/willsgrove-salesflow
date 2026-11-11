import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { listInvoiceClaims } from "@/lib/invoice-claims/queries";
import {
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_STYLES,
  CLAIM_CATEGORY_LABELS,
  CLAIM_PRIORITY_LABELS,
  CLAIM_PRIORITY_STYLES,
} from "@/lib/invoice-claims/display";
import { initialsFor, avatarColorFor } from "@/lib/order-display";
import Sidebar from "../components/sidebar";
import { FileWarning, ChevronRight, ChevronLeft, Plus, BarChart3 } from "lucide-react";

/**
 * Milestone 6A (Invoice Claims Management).
 *
 * The /invoice-claims list (spec section 8): every open/in-progress/
 * resolved claim, filterable by status/category/priority, with drill-
 * down into each claim's detail. Same "deliberately simple Server
 * Component list, plain query-string pagination" choice as
 * /invoice-reconciliation and /lost-sales.
 */
export const instant = false;

const PAGE_SIZE = 25;

const STATUS_FILTERS = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "AWAITING_CUSTOMER",
  "AWAITING_INTERNAL_ACTION",
  "APPROVED",
  "PARTIALLY_RESOLVED",
  "RESOLVED",
  "REJECTED",
  "CLOSED",
];

type RouteParams = { searchParams: Promise<{ page?: string; status?: string; search?: string; customerId?: string }> };

export default async function InvoiceClaimsPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const requestedPage = Number(resolved.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const status = resolved.status && STATUS_FILTERS.includes(resolved.status) ? resolved.status : undefined;
  const search = resolved.search?.trim() || undefined;
  const rawCustomerId = resolved.customerId?.trim();
  const customerId = rawCustomerId && isValidId(rawCustomerId) ? rawCustomerId : undefined;

  const { rows: claims, total, totalPages } = await listInvoiceClaims({ status, search, customerId }, page, PAGE_SIZE);

  const query = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    if (customerId) params.set("customerId", customerId);
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    });
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Claims</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Invoice Claims Management</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/invoice-claims/dashboard"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              <BarChart3 size={14} />
              Dashboard
            </Link>
            <Link
              href="/invoice-claims/new"
              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#122E23]"
            >
              <Plus size={14} />
              File a claim
            </Link>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Claims Queue</h1>
            <p className="mt-1 text-sm text-gray-500">
              Customer complaints, disputed quantities, pricing disputes and quality issues raised against SAP
              invoices -- distinct from a physical return or an issued SAP credit note, which are tracked once
              a claim&rsquo;s resolution is approved (Milestone 6B). {total} claim{total === 1 ? "" : "s"} total.
            </p>
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <Link
              href="/invoice-claims"
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                !status ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
              }`}
            >
              All
            </Link>
            {STATUS_FILTERS.map((value) => (
              <Link
                key={value}
                href={`/invoice-claims${query({ status: value, page: "1" })}`}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  status === value ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {CLAIM_STATUS_LABELS[value] ?? value}
              </Link>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {claims.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <FileWarning size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">Nothing here</p>
                <p className="mt-1 text-xs text-gray-400">No claims match this filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Claim</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">SAP invoice</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Category</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Priority</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Lines</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((claim) => (
                      <tr key={claim.id} className="border-b border-gray-50">
                        <td className="whitespace-nowrap px-6 py-4">
                          <p className="text-xs font-semibold text-[#173D2E]">{claim.claimReference}</p>
                          <p className="text-[10px] text-gray-400">{new Date(claim.claimDate).toLocaleDateString()}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(claim.customer.name)}`}>
                              {initialsFor(claim.customer.name)}
                            </div>
                            <span className="text-xs font-medium text-gray-700">{claim.customer.name}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{claim.sapInvoice.sapDocNum}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{CLAIM_CATEGORY_LABELS[claim.category] ?? claim.category}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${CLAIM_PRIORITY_STYLES[claim.priority] ?? "bg-gray-100 text-gray-500"}`}>
                            {CLAIM_PRIORITY_LABELS[claim.priority] ?? claim.priority}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{claim.lines.length}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${CLAIM_STATUS_STYLES[claim.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {CLAIM_STATUS_LABELS[claim.status] ?? claim.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Link href={`/invoice-claims/${claim.id}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]">
                            Open
                            <ChevronRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {totalPages > 1 && (
            <nav className="flex items-center justify-between">
              <Link
                href={`/invoice-claims${query({ page: String(Math.max(1, page - 1)) })}`}
                aria-disabled={page <= 1}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page <= 1 ? "pointer-events-none opacity-40" : ""
                }`}
              >
                <ChevronLeft size={14} />
                Previous
              </Link>
              <p className="text-xs text-gray-400">
                Page {page} of {totalPages}
              </p>
              <Link
                href={`/invoice-claims${query({ page: String(Math.min(totalPages, page + 1)) })}`}
                aria-disabled={page >= totalPages}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page >= totalPages ? "pointer-events-none opacity-40" : ""
                }`}
              >
                Next
                <ChevronRight size={14} />
              </Link>
            </nav>
          )}

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
