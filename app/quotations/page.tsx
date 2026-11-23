"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "../components/sidebar";
import { DateRangePicker } from "../components/date-picker";
import { FormSelect } from "../components/form-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QUOTATION_STATUS_LABELS, QUOTATION_STATUS_STYLES } from "@/lib/quotations/display";
import { initialsFor, avatarColorFor, formatOrderAmount as formatAmount } from "@/lib/order-display";
import {
  Search,
  Plus,
  Eye,
  AlertCircle,
  Loader2,
  FileText,
  Clock3,
  CheckCircle2,
  XCircle,
  CalendarClock,
} from "lucide-react";

/**
 * Milestone 7 (Quotations Management), spec section 10's dashboard/list
 * page. Mirrors app/orders/page.tsx's client-rendered search+filter+
 * pagination pattern (the most feature-complete existing list page in
 * this project) rather than invoice-claims'/returns-credits' simpler
 * Server Component + plain query-string pages, since quotations needs
 * live search across number/customer/salesperson plus a currency-
 * grouped date range -- all genuinely easier to express as controlled
 * inputs than as a page reload per keystroke.
 *
 * Dashboard figures come from GET /api/quotations/dashboard
 * (lib/quotations/queries.ts's getQuotationDashboardCounts) -- real
 * database counts, never estimated. "Value by status" is deliberately
 * NOT summed across currencies and is never labelled as revenue (spec
 * section 10's explicit warning) -- see the dedicated card below.
 */

const STATUS_VALUES = Object.keys(QUOTATION_STATUS_LABELS);

type QuotationSummary = {
  id: string;
  quotationNumber: string;
  revisionNumber: number;
  status: string;
  quotationDate: string;
  validUntil: string;
  currency: string;
  total: string;
  isSuperseded: boolean;
  awaitingResponse: boolean;
  nextFollowUpDate: string | null;
  isDemo: boolean;
  createdAt: string;
  customer: { id: string; name: string } | null;
  salesperson: { id: string; name: string } | null;
  lineCount: number;
};

type QuotationListResponse = {
  success: boolean;
  message?: string;
  quotations: QuotationSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

type DashboardCounts = {
  total: number;
  draft: number;
  issuedAwaitingResponse: number;
  accepted: number;
  rejected: number;
  expired: number;
  cancelled: number;
  valueByStatus: { status: string; currency: string; total: string }[];
  dueForFollowUp: number;
};

type SalespersonOption = { id: string; name: string };

function formatDateOnly(value: string): string {
  // Values here are already YYYY-MM-DD-derived ISO strings (see
  // lib/quotations/queries.ts's listQuotations) -- sliced, not
  // re-parsed, so no timezone shift can move the displayed day.
  return value.slice(0, 10);
}

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, totalItems: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeStatus, setActiveStatus] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [salespersonId, setSalespersonId] = useState("");
  const [currency, setCurrency] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);
  const [counts, setCounts] = useState<DashboardCounts | null>(null);

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetch("/api/users", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data.success && Array.isArray(data.users)) {
          setSalespeople(data.users.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/quotations/dashboard", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!ignore && data.success) setCounts(data.counts);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
    // Re-fetched whenever the page re-mounts a fresh list (e.g. after
    // creating/issuing a quotation and navigating back) -- intentionally
    // NOT re-run on every filter change, since the dashboard figures
    // describe the whole book, not the current filtered view.
  }, []);

  useEffect(() => {
    let ignore = false;

    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (activeStatus !== "ALL") params.set("status", activeStatus);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (salespersonId) params.set("salespersonId", salespersonId);
    if (currency) params.set("currency", currency);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    Promise.resolve()
      .then(() => {
        setLoading(true);
        setLoadError(null);
        return fetch(`/api/quotations?${params.toString()}`, { cache: "no-store" });
      })
      .then((response) => response.json().then((data: QuotationListResponse) => ({ response, data })))
      .then(({ response, data }) => {
        if (ignore) return;
        if (!response.ok || !data.success) {
          setLoadError(data.message ?? "Unable to load quotations.");
          setQuotations([]);
          return;
        }
        setQuotations(data.quotations);
        setPagination(data.pagination);
      })
      .catch(() => {
        if (!ignore) {
          setLoadError("Could not reach the server. Check your connection and try again.");
          setQuotations([]);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [activeStatus, debouncedSearch, salespersonId, currency, dateFrom, dateTo, page]);

  const summaryCards = useMemo(
    () => [
      { title: "Total Quotations", value: counts?.total ?? null, icon: FileText, color: "bg-blue-50 text-blue-600", note: "Current revisions, excluding demo data" },
      { title: "Draft", value: counts?.draft ?? null, icon: Clock3, color: "bg-gray-50 text-gray-600", note: "Not yet issued" },
      { title: "Issued -- Awaiting Response", value: counts?.issuedAwaitingResponse ?? null, icon: CalendarClock, color: "bg-cyan-50 text-cyan-700", note: "Sent to the customer" },
      { title: "Accepted", value: counts?.accepted ?? null, icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700", note: "Customer confirmed" },
      { title: "Rejected / Expired", value: counts !== null ? counts.rejected + counts.expired : null, icon: XCircle, color: "bg-red-50 text-red-600", note: "No longer actionable" },
      { title: "Due For Follow-up", value: counts?.dueForFollowUp ?? null, icon: AlertCircle, color: "bg-amber-50 text-amber-600", note: "Follow-up date has passed" },
    ],
    [counts]
  );

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Sales Management / Quotations</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Quotations</h2>
          </div>
        </header>

        <div className="space-y-7 p-8">
          <section className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Quotations Management</h1>
              <p className="mt-2 text-sm text-gray-500">
                Price proposals for customers requesting pricing before placing an order. SAP Business One remains
                authoritative for inventory, accounting, VAT and invoicing -- nothing here is a financial transaction
                until a quotation is converted into a real customer order.
              </p>
            </div>
            <Link
              href="/quotations/new"
              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#24543F]"
            >
              <Plus size={16} />
              New Quotation
            </Link>
          </section>

          <section className="grid grid-cols-3 gap-5 lg:grid-cols-6">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="rounded-xl border border-[#E8EBE6] bg-white p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-gray-500">{card.title}</p>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.color}`}>
                      <Icon size={16} />
                    </div>
                  </div>
                  <h3 className="mt-3 text-2xl font-bold text-[#17251E]">{card.value === null ? "—" : card.value}</h3>
                  <p className="mt-1 text-[10px] text-gray-400">{card.note}</p>
                </div>
              );
            })}
          </section>

          {counts && counts.valueByStatus.length > 0 && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h2 className="text-sm font-bold text-[#17251E]">Quoted value by status &amp; currency</h2>
              <p className="mt-1 text-[11px] text-gray-400">
                Proposed sales values from Sales-entered prices -- never revenue, and never summed across currencies.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {counts.valueByStatus.map((row) => (
                  <div key={`${row.status}-${row.currency}`} className="rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-gray-700">{QUOTATION_STATUS_LABELS[row.status] ?? row.status}</span>
                    <span className="ml-2 text-gray-500">{formatAmount(row.total, row.currency)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <Tabs value={activeStatus} onValueChange={(value) => { setActiveStatus(value as typeof activeStatus); setPage(1); }}>
              <TabsList className="h-auto w-full justify-start gap-4 overflow-x-auto rounded-none border-b border-gray-100 bg-transparent px-6 py-0">
                <TabsTrigger value="ALL" className="h-auto flex-none rounded-none border-0 border-b-2 border-transparent px-0 py-4 text-xs font-medium text-gray-400 shadow-none data-[state=active]:border-[#28583F] data-[state=active]:bg-transparent data-[state=active]:text-[#28583F] data-[state=active]:shadow-none">
                  All
                </TabsTrigger>
                {STATUS_VALUES.map((status) => (
                  <TabsTrigger
                    key={status}
                    value={status}
                    className="h-auto flex-none rounded-none border-0 border-b-2 border-transparent px-0 py-4 text-xs font-medium text-gray-400 shadow-none data-[state=active]:border-[#28583F] data-[state=active]:bg-transparent data-[state=active]:text-[#28583F] data-[state=active]:shadow-none"
                  >
                    {QUOTATION_STATUS_LABELS[status]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-wrap items-end gap-3 border-b border-gray-100 px-6 py-4">
              <div className="relative max-w-sm flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by number or customer..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 pl-9 pr-4 text-xs md:text-xs"
                />
              </div>
              <FormSelect
                value={salespersonId}
                onValueChange={(value) => { setSalespersonId(value); setPage(1); }}
                options={[{ value: "", label: "All salespeople" }, ...salespeople.map((person) => ({ value: person.id, label: person.name }))]}
                className="h-10 w-48 text-xs"
                aria-label="Salesperson"
              />
              <Input
                type="text"
                placeholder="Currency (e.g. USD)"
                value={currency}
                onChange={(event) => { setCurrency(event.target.value.toUpperCase()); setPage(1); }}
                className="h-10 w-32 text-xs md:text-xs"
              />
              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={(range) => {
                  setDateFrom(range.from);
                  setDateTo(range.to);
                  setPage(1);
                }}
              />
              <p className="ml-auto whitespace-nowrap text-[11px] text-gray-400">
                {pagination.totalItems} quotation{pagination.totalItems === 1 ? "" : "s"} found
              </p>
            </div>

            {loadError && (
              <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-6 py-3 text-xs text-red-700">
                <AlertCircle size={14} />
                {loadError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/70">
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Quotation</th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Salesperson</th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Valid Until</th>
                    <th className="px-6 py-4 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Total</th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <Loader2 size={22} className="animate-spin" />
                          <p className="text-xs">Loading quotations...</p>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    quotations.map((quotation) => {
                      const customerName = quotation.customer?.name ?? "Unknown customer";
                      return (
                        <tr key={quotation.id} className="border-b border-gray-50 transition hover:bg-gray-50/70">
                          <td className="whitespace-nowrap px-6 py-4">
                            <Link href={`/quotations/${quotation.id}`} className="text-xs font-semibold text-[#28583F] transition hover:text-[#6A8D43] hover:underline">
                              {quotation.quotationNumber}
                              {quotation.revisionNumber > 1 && <span className="ml-1 text-gray-400">rev {quotation.revisionNumber}</span>}
                            </Link>
                            <p className="mt-1 text-[10px] text-gray-400">
                              {quotation.lineCount} line{quotation.lineCount === 1 ? "" : "s"}
                              {quotation.awaitingResponse && " · awaiting response"}
                              {quotation.isDemo && " · Demo"}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(customerName)}`}>
                                {initialsFor(customerName)}
                              </div>
                              <p className="text-xs font-medium text-gray-700">{customerName}</p>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">{quotation.salesperson?.name ?? "-"}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">{formatDateOnly(quotation.validUntil)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right text-xs font-semibold text-gray-700">{formatAmount(quotation.total, quotation.currency)}</td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <span className={`rounded-full px-2.5 py-1.5 text-[10px] font-semibold ${QUOTATION_STATUS_STYLES[quotation.status] ?? "bg-gray-100 text-gray-500"}`}>
                              {QUOTATION_STATUS_LABELS[quotation.status] ?? quotation.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <Link href={`/quotations/${quotation.id}`} title={`View ${quotation.quotationNumber}`} aria-label={`View quotation ${quotation.quotationNumber}`} className="inline-flex text-gray-400 transition hover:text-[#28583F]">
                              <Eye size={17} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}

                  {!loading && !loadError && quotations.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <Search size={25} className="text-gray-300" />
                          <p className="mt-3 text-sm font-semibold text-gray-600">No quotations found</p>
                          <p className="mt-1 text-xs text-gray-400">Try changing your search or filters.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <p className="text-[11px] text-gray-400">
                Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} total
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.page <= 1}>
                  Previous
                </Button>
                <Badge className="bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white">{pagination.page}</Badge>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={pagination.page >= pagination.totalPages}>
                  Next
                </Button>
              </div>
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
