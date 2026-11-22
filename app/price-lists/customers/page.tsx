"use client";

/**
 * Real Business Data Onboarding round (spec PART A, Phase 4b).
 *
 * No UI anywhere lets staff view or assign a customer's price list
 * (confirmed: zero references to priceListId/priceList in app/customers
 * or app/api/customers before this round). The real customer-master
 * source (business-data/List_of_Business_Partners.xlsx, the LEAN layout
 * lib/sap-customer-master-csv.ts documents) has no price-list column at
 * all, so no customer can be auto-assigned one from the data this
 * business actually has -- every assignment here is a deliberate staff
 * action, never guessed or defaulted.
 *
 * This page lists every customer with their current assignment (null for
 * almost all of them until staff work through this list) and lets staff
 * search, filter by assignment state, and change it inline via the
 * existing, unmodified PATCH /api/customers/[id] endpoint (now accepting
 * priceListId -- see lib/customer-validation.ts/lib/customers.ts).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, DollarSign, CheckCircle2, AlertCircle } from "lucide-react";
import Sidebar from "../../components/sidebar";

const PAGE_SIZE = 50;

type PriceListOption = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  entryCount: number;
  customerCount: number;
};

type CustomerRow = {
  id: string;
  name: string;
  sapCustomerCode: string | null;
  category: string | null;
  status: "ACTIVE" | "INACTIVE";
  priceListId: string | null;
  priceList: { id: string; code: string; name: string } | null;
};

type ListResponse = {
  success: true;
  customers: CustomerRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

type AssignmentFilter = "ALL" | "UNASSIGNED" | string; // string = a PriceList id

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export default function CustomerPricingPage() {
  const [priceLists, setPriceLists] = useState<PriceListOption[]>([]);
  const [priceListsError, setPriceListsError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [pagination, setPagination] = useState<ListResponse["pagination"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("ALL");
  const [page, setPage] = useState(1);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [rowSuccessId, setRowSuccessId] = useState<string | null>(null);

  // Real-world fix (bulk price-list assignment): the real customer-master
  // export has no price-list column (see the page intro copy below), so
  // with ~2,647 customers, one-row-at-a-time assignment above is not
  // realistic. This lets staff assign every customer matching the SAME
  // search/assignmentFilter already applied to the table -- never a
  // separate, driftable filter -- to one target list, confirming against
  // the live matched count first.
  const [bulkTargetId, setBulkTargetId] = useState<string>("");
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ count: number; code: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/price-lists", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.success) {
          setPriceLists(body.priceLists as PriceListOption[]);
        } else {
          setPriceListsError(body?.message ?? "Unable to load price lists.");
        }
      })
      .catch(() => {
        if (!cancelled) setPriceListsError("Could not reach the server while loading price lists.");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (assignmentFilter !== "ALL") params.set("priceListId", assignmentFilter);

        const response = await fetch(`/api/customers?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.success) {
          throw new Error(body?.message ?? "Unable to load customers.");
        }

        setCustomers(body.customers as CustomerRow[]);
        setPagination(body.pagination as ListResponse["pagination"]);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Unable to load customers.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [page, debouncedSearch, assignmentFilter, reloadKey]);

  async function assignPriceList(customerId: string, priceListId: string | null) {
    setSavingId(customerId);
    setRowError(null);
    setRowSuccessId(null);

    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceListId }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || body?.success !== true) {
        setRowError({ id: customerId, message: body?.message ?? "Unable to update this customer's price list." });
        return;
      }

      const updatedList = body.customer?.priceList ?? null;
      setCustomers((current) =>
        current.map((c) => (c.id === customerId ? { ...c, priceListId, priceList: updatedList } : c))
      );
      setRowSuccessId(customerId);
      setReloadKey((key) => key + 1); // refresh price-list customer counts
      setTimeout(() => setRowSuccessId((id) => (id === customerId ? null : id)), 2000);
    } catch {
      setRowError({ id: customerId, message: "Could not reach the server. Please try again." });
    } finally {
      setSavingId(null);
    }
  }

  async function confirmBulkAssign() {
    setBulkSaving(true);
    setBulkError(null);

    const targetList = bulkTargetId === "" ? null : priceLists.find((list) => list.id === bulkTargetId) ?? null;

    try {
      const response = await fetch("/api/customers/bulk-assign-price-list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search: debouncedSearch,
          priceListId: assignmentFilter === "ALL" ? null : assignmentFilter,
          targetPriceListId: bulkTargetId === "" ? null : bulkTargetId,
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || body?.success !== true) {
        setBulkError(body?.message ?? "Unable to assign the price list to these customers.");
        return;
      }

      setBulkResult({ count: body.matchedCount as number, code: targetList ? targetList.code : "Unassigned" });
      setBulkConfirming(false);
      setReloadKey((key) => key + 1);
    } catch {
      setBulkError("Could not reach the server. Please try again.");
    } finally {
      setBulkSaving(false);
    }
  }

  const rangeStart = pagination && pagination.totalItems > 0 ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const rangeEnd = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.totalItems) : 0;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / SAP master data / Customer pricing</p>
            <h1 className="mt-1 text-lg font-semibold">Customer pricing</h1>
          </div>
        </header>

        <div className="mx-auto max-w-[1300px] p-5 md:p-9">
          <Link href="/customers" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to customers
          </Link>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">Assign customer price lists</h2>
            <p className="mt-1 text-sm text-[#7D8981]">
              SalesFlow has no source data linking a customer to a price list -- the real customer-master export
              doesn&apos;t carry one. Every assignment below is a deliberate choice, made here, one customer at a
              time (or in bulk by filtering to &quot;Unassigned&quot;).
            </p>
          </div>

          {priceListsError && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#F1D9D9] bg-[#FFF6F6] px-4 py-3 text-sm text-[#9B3B3B]">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>{priceListsError}</p>
            </div>
          )}

          {priceLists.length === 0 && !priceListsError && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#F0E3C2] bg-[#FFFAEE] px-4 py-3 text-sm text-[#8A6212]">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>
                No price lists have been imported yet.{" "}
                <Link href="/price-lists/import" className="font-semibold underline">
                  Import price lists
                </Link>{" "}
                before assigning one here.
              </p>
            </div>
          )}

          {priceLists.length > 0 && (
            <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {priceLists.map((list) => (
                <Link
                  key={list.id}
                  href={`/price-lists/${list.id}`}
                  className="rounded-xl border border-[#E8ECE7] bg-white p-3 transition hover:border-[#7C9D87] hover:shadow-sm"
                >
                  <p className="truncate text-xs font-semibold text-[#315C43]" title={list.name}>
                    {list.code}
                  </p>
                  <p className="mt-1 text-[11px] text-[#89948D]">{list.currencyCode}</p>
                  <p className="mt-2 text-lg font-semibold">{formatNumber(list.customerCount)}</p>
                  <p className="text-[11px] text-[#9AA39D]">customer(s) -- {formatNumber(list.entryCount)} price(s)</p>
                </Link>
              ))}
            </div>
          )}

          {priceLists.length > 0 && (
            <section className="mb-7 rounded-xl border border-[#E8ECE7] bg-white p-5">
              <h3 className="font-semibold">Bulk assign</h3>
              <p className="mt-1 text-xs text-[#89948D]">
                Assigns every customer currently matching your search and filter above (not just this page) to one
                price list in a single action -- the practical way to work through thousands of customers when no
                import can do it for you.
              </p>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <p className="text-sm text-[#5E7366]">
                  {pagination ? (
                    <>
                      <span className="font-semibold text-[#17251E]">{formatNumber(pagination.totalItems)}</span> customer
                      {pagination.totalItems === 1 ? "" : "s"} match{" "}
                      {debouncedSearch ? <>&quot;{debouncedSearch}&quot;</> : "your current filter"}
                    </>
                  ) : (
                    "Loading..."
                  )}
                </p>

                <select
                  value={bulkTargetId}
                  onChange={(event) => {
                    setBulkTargetId(event.target.value);
                    setBulkConfirming(false);
                    setBulkResult(null);
                  }}
                  className="rounded-lg border border-[#E1E7E0] bg-white px-3 py-2 text-sm outline-none sm:w-56"
                >
                  <option value="" disabled>
                    Assign to...
                  </option>
                  <option value="">Unassigned</option>
                  {priceLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.code} ({list.currencyCode})
                    </option>
                  ))}
                </select>

                {!bulkConfirming ? (
                  <button
                    onClick={() => setBulkConfirming(true)}
                    disabled={!pagination || pagination.totalItems === 0 || bulkSaving}
                    className="rounded-lg bg-[#315C43] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#274A35] disabled:opacity-40"
                  >
                    Bulk assign
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={confirmBulkAssign}
                      disabled={bulkSaving}
                      className="rounded-lg bg-[#9B3B3B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#832F2F] disabled:opacity-60"
                    >
                      {bulkSaving
                        ? "Assigning..."
                        : `Confirm: assign ${pagination ? formatNumber(pagination.totalItems) : ""} customer(s)`}
                    </button>
                    <button
                      onClick={() => setBulkConfirming(false)}
                      disabled={bulkSaving}
                      className="rounded-lg border border-[#E1E7E0] bg-white px-3 py-2 text-sm text-[#5E7366] hover:bg-[#FAFBF9]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {bulkError && <p className="mt-3 text-sm text-[#9B3B3B]">{bulkError}</p>}
              {bulkResult && (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-[#347447]">
                  <CheckCircle2 size={15} />
                  Assigned {formatNumber(bulkResult.count)} customer(s) to {bulkResult.code}.
                </p>
              )}
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-[#E8ECE7] bg-white">
            <div className="flex flex-col justify-between gap-4 border-b border-[#E8ECE7] p-5 lg:flex-row lg:items-center">
              <div>
                <h3 className="font-semibold">All customers</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  {pagination ? `${formatNumber(pagination.totalItems)} matching customer accounts` : "Loading customers..."}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-64">
                  <Search size={16} className="text-[#89948D]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name or SAP code..."
                    maxLength={100}
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#A3ACA6]"
                  />
                </div>

                <select
                  value={assignmentFilter}
                  onChange={(event) => {
                    setAssignmentFilter(event.target.value);
                    setPage(1);
                  }}
                  className="rounded-lg border border-[#E5EAE4] bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="ALL">All customers</option>
                  <option value="UNASSIGNED">Unassigned only</option>
                  {priceLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div className="flex flex-col items-start justify-between gap-3 border-b border-[#F1D9D9] bg-[#FFF6F6] px-5 py-4 sm:flex-row sm:items-center">
                <p className="text-sm text-[#9B3B3B]">{error}</p>
                <button
                  onClick={() => setReloadKey((key) => key + 1)}
                  className="rounded-lg border border-[#E7C4C4] bg-white px-4 py-2 text-sm font-medium text-[#9B3B3B] hover:bg-[#FFF0F0]"
                >
                  Try again
                </button>
              </div>
            )}

            <div className={`overflow-x-auto transition-opacity ${loading && customers.length > 0 ? "opacity-50" : "opacity-100"}`}>
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[#FAFBF9] text-xs text-[#89948D]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">SAP code</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Price list</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1ED]">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-[#FAFBF9]">
                      <td className="px-5 py-4">
                        <Link href={`/customers/${customer.id}`} className="text-sm font-medium hover:text-[#315C43] hover:underline">
                          {customer.name}
                        </Link>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-[#7D8981]">{customer.sapCustomerCode ?? "-"}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            customer.status === "ACTIVE" ? "bg-[#EAF5EC] text-[#347447]" : "bg-[#F1F2F0] text-[#778078]"
                          }`}
                        >
                          {customer.status === "ACTIVE" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <select
                            value={customer.priceListId ?? ""}
                            disabled={savingId === customer.id || priceLists.length === 0}
                            onChange={(event) => assignPriceList(customer.id, event.target.value === "" ? null : event.target.value)}
                            className="min-w-[160px] rounded-lg border border-[#E1E7E0] bg-white px-2.5 py-1.5 text-sm outline-none disabled:opacity-50"
                          >
                            <option value="">Unassigned</option>
                            {priceLists.map((list) => (
                              <option key={list.id} value={list.id}>
                                {list.code} ({list.currencyCode})
                              </option>
                            ))}
                          </select>
                          {savingId === customer.id && <span className="text-xs text-[#89948D]">Saving...</span>}
                          {rowSuccessId === customer.id && <CheckCircle2 size={16} className="text-[#347447]" />}
                        </div>
                        {rowError?.id === customer.id && <p className="mt-1.5 text-xs text-[#9B3B3B]">{rowError.message}</p>}
                      </td>
                    </tr>
                  ))}

                  {!loading && !error && customers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center text-sm text-[#89948D]">
                        No customers match this search or filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col items-start justify-between gap-3 border-t border-[#E8ECE7] px-5 py-4 text-xs text-[#89948D] sm:flex-row sm:items-center">
              <span>
                {pagination
                  ? `Showing ${formatNumber(rangeStart)}-${formatNumber(rangeEnd)} of ${formatNumber(pagination.totalItems)} customers`
                  : ""}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={!pagination || pagination.page <= 1 || loading}
                  className="rounded-lg border border-[#E5EAE4] px-3 py-1.5 text-[#315C43] hover:bg-[#F7F8F6] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span>
                  Page {pagination?.page ?? 1} of {pagination?.totalPages ?? 1}
                </span>
                <button
                  onClick={() => setPage((current) => current + 1)}
                  disabled={!pagination || pagination.page >= pagination.totalPages || loading}
                  className="rounded-lg border border-[#E5EAE4] px-3 py-1.5 text-[#315C43] hover:bg-[#F7F8F6] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>

            <p className="flex items-center gap-1.5 border-t border-[#E8ECE7] px-5 py-3 text-xs text-[#9AA39D]">
              <DollarSign size={12} />
              Today, a customer&apos;s assigned price list is used to estimate the value of a lost sale when no
              order-line price is already on record (Lost Sales analytics) -- it does not yet set the price on
              new orders, which still comes from each order&apos;s own source (the customer&apos;s PO/SAP data).
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
