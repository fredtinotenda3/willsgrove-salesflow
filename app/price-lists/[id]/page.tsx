"use client";

/**
 * Real Business Data Onboarding round, follow-up fix: "the ability to
 * change or update prices" -- before this, a price list's entries could
 * only ever be set by re-running the whole xlsx/CSV import; there was no
 * way to view or correct one entry at a time. This page is a searchable,
 * paginated view of one price list's entries with an inline, audited
 * single-entry price edit (GET/PATCH /api/price-lists/[id]/entries and
 * /api/price-lists/entries/[id] -- lib/price-list-queries.ts).
 *
 * Deliberately does not let an operator change validFrom/validTo or add/
 * remove entries here -- a hand correction to today's price is a
 * different business event from a new validity period starting or an
 * item being added to a list, which the bulk import path already owns.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Search, Pencil, Check, X, AlertCircle } from "lucide-react";
import Sidebar from "../../components/sidebar";

const PAGE_SIZE = 25;

type PriceListDetail = { id: string; code: string; name: string; currencyCode: string };

type EntryRow = {
  id: string;
  sapItemCodeSnapshot: string;
  productId: string | null;
  productName: string | null;
  unitPrice: string;
  validFrom: string;
  validTo: string | null;
};

type ListResponse = {
  success: true;
  priceList: PriceListDetail;
  entries: EntryRow[];
  totalItems: number;
  page: number;
  pageSize: number;
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export default function PriceListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [priceList, setPriceList] = useState<PriceListDetail | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      const query = new URLSearchParams({ page: String(page) });
      if (search.trim()) query.set("search", search.trim());

      try {
        const res = await fetch(`/api/price-lists/${id}/entries?${query.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (res.ok && body && typeof body === "object" && (body as { success?: boolean }).success) {
          const data = body as ListResponse;
          setPriceList(data.priceList);
          setEntries(data.entries);
          setTotalItems(data.totalItems);
        } else {
          setError((body as { message?: string })?.message ?? "Unable to load this price list.");
        }
      } catch {
        if (controller.signal.aborted) return;
        setError("Could not reach the server.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [id, page, search]);

  function startEdit(entry: EntryRow) {
    setEditingId(entry.id);
    setEditValue(entry.unitPrice);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function saveEdit(entryId: string) {
    setSavingId(entryId);
    setRowError(null);
    try {
      const response = await fetch(`/api/price-lists/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitPrice: editValue.trim() }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && body && typeof body === "object" && (body as { success?: boolean }).success) {
        const newPrice = (body as { unitPrice: string }).unitPrice;
        setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, unitPrice: newPrice } : e)));
        setEditingId(null);
        toast.success("Price updated", { description: newPrice });
      } else {
        const message = (body as { message?: string })?.message ?? "Unable to save this price.";
        setRowError({ id: entryId, message });
        toast.error("Unable to update price", { description: message });
      }
    } catch {
      setRowError({ id: entryId, message: "Could not reach the server." });
      toast.error("Network error", { description: "Could not reach the server. Check your connection and try again." });
    } finally {
      setSavingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />
      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / Price lists</p>
            <h1 className="mt-1 text-lg font-semibold">{priceList ? `${priceList.code} -- ${priceList.name}` : "Price list"}</h1>
          </div>
        </header>

        <div className="mx-auto max-w-[1100px] p-5 md:p-9">
          {/* Follow-up fix ("Price should also have its own page too"):
              now that /price-lists exists as this page's real parent in
              the nav, this points there instead of the unrelated
              Customer Pricing (assignment) tool. */}
          <Link href="/price-lists" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to price lists
          </Link>

          {notFound && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">Price list not found.</div>
          )}

          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {!notFound && (
            <section className="overflow-hidden rounded-xl border border-[#E8ECE7] bg-white">
              <div className="flex flex-col justify-between gap-4 border-b border-[#E8ECE7] p-5 lg:flex-row lg:items-center">
                <div>
                  <h3 className="font-semibold">Entries</h3>
                  <p className="mt-1 text-xs text-[#89948D]">{formatNumber(totalItems)} item(s) in {priceList?.currencyCode ?? ""}</p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-64">
                  <Search size={16} className="text-[#89948D]" />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search item code or name..."
                    maxLength={100}
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#A3ACA6]"
                  />
                </div>
              </div>

              {/* Real-world fix ("responsive tables app-wide"): this table had
                  no horizontal-scroll wrapper, unlike every other table page
                  in the app (app/lost-sales/page.tsx, app/customers/page.tsx,
                  etc.) -- on a narrow screen its 5 columns would otherwise
                  force the whole page to scroll sideways instead of just the
                  table. */}
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#FAFBF9] text-[11px] uppercase tracking-wide text-[#89948D]">
                  <tr>
                    <th className="px-5 py-3">Item code</th>
                    <th className="px-5 py-3">Item name</th>
                    <th className="px-5 py-3">Unit price</th>
                    <th className="px-5 py-3">Valid from</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-xs text-[#9AA39D]">Loading...</td>
                    </tr>
                  )}
                  {!loading && entries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-xs text-[#9AA39D]">No entries match.</td>
                    </tr>
                  )}
                  {!loading &&
                    entries.map((entry) => (
                      <tr key={entry.id} className="border-t border-[#F0F2EF]">
                        <td className="px-5 py-3 font-mono text-xs">{entry.sapItemCodeSnapshot}</td>
                        <td className="px-5 py-3 text-xs text-[#5E6A62]">{entry.productName ?? "--"}</td>
                        <td className="px-5 py-3">
                          {editingId === entry.id ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              inputMode="decimal"
                              className="h-8 w-28 rounded-md border border-[#7C9D87] px-2 text-xs outline-none"
                            />
                          ) : (
                            <span className="font-medium">{entry.unitPrice}</span>
                          )}
                          {rowError?.id === entry.id && <p className="mt-1 text-[10px] text-red-600">{rowError.message}</p>}
                        </td>
                        <td className="px-5 py-3 text-xs text-[#89948D]">{entry.validFrom.slice(0, 10)}</td>
                        <td className="px-5 py-3 text-right">
                          {editingId === entry.id ? (
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                disabled={savingId === entry.id}
                                onClick={() => saveEdit(entry.id)}
                                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#315C43] text-white disabled:opacity-50"
                                aria-label="Save"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5EAE4]"
                                aria-label="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEdit(entry)}
                              className="inline-flex items-center gap-1 text-xs text-[#5E7366] hover:text-[#315C43]"
                            >
                              <Pencil size={13} />
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-[#E8ECE7] px-5 py-3 text-xs text-[#89948D]">
                  <span>Page {page} of {totalPages}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-[#E5EAE4] px-3 py-1 disabled:opacity-40">
                      Previous
                    </button>
                    <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-[#E5EAE4] px-3 py-1 disabled:opacity-40">
                      Next
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
