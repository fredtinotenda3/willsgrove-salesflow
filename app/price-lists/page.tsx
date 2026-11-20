"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeDollarSign,
  Clock3,
  Plus,
  Receipt,
  Search,
  Tags,
  Upload,
  Users,
  X,
} from "lucide-react";
import Sidebar from "../components/sidebar";

/**
 * Follow-up fix: "Price should also have its own page too with its stats
 * card and other necessary info... Price page should also have button to
 * add and import functionality like customer and products pages."
 *
 * Before this, /price-lists had no landing page at all -- only the
 * import flow (/price-lists/import), the per-list entry editor
 * (/price-lists/[id]), and the customer-assignment page
 * (/price-lists/customers). This is that landing page, mirroring
 * app/customers/page.tsx's own layout (stats cards, search, table, an
 * "Add" modal for a single hand-created record, and an "Import" link for
 * the bulk SAP flow) and app/products/page.tsx's (stats-card grid,
 * read-only master-data framing).
 *
 * Price lists are few in number (the real SAP export has 7 -- see
 * lib/price-list-queries.ts's own module comment), so unlike the
 * Customers/Products tables this one is not paginated: the API returns
 * every price list in one response and this page filters client-side.
 */

type ApiPriceList = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  createdAt: string;
  entryCount: number;
  customerCount: number;
};

type PriceListStats = {
  totalLists: number;
  totalEntries: number;
  customersAssigned: number;
  currencyCount: number;
  lastImportedAt: string | null;
};

type ApiBody = {
  success?: boolean;
  message?: string;
  priceLists?: ApiPriceList[];
  stats?: PriceListStats;
  id?: string;
  fieldErrors?: Record<string, string>;
};

type FieldErrors = Record<string, string>;

type AddValues = {
  code: string;
  name: string;
  currencyCode: string;
};

const emptyAddValues: AddValues = { code: "", name: "", currencyCode: "USD" };

function formatNumber(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString("en-US");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

async function readJson(response: Response): Promise<ApiBody | null> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as ApiBody) : null;
  } catch {
    return null;
  }
}

export default function PriceListsPage() {
  const [priceLists, setPriceLists] = useState<ApiPriceList[] | null>(null);
  const [stats, setStats] = useState<PriceListStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [addValues, setAddValues] = useState<AddValues>(emptyAddValues);
  const [addErrors, setAddErrors] = useState<FieldErrors>({});
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/price-lists", { signal: controller.signal, cache: "no-store" });
        const body = await readJson(response);

        if (!response.ok || !body?.success) {
          throw new Error(body?.message ?? "Unable to load price lists.");
        }

        setPriceLists(body.priceLists ?? []);
        setStats(body.stats ?? null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load price lists.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [reloadKey]);

  const filteredLists = useMemo(() => {
    const all = priceLists ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((l) => l.code.toLowerCase().includes(term) || l.name.toLowerCase().includes(term));
  }, [priceLists, search]);

  function openAddModal() {
    setAddValues(emptyAddValues);
    setAddErrors({});
    setAddMessage(null);
    setShowAdd(true);
  }

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddSaving(true);
    setAddErrors({});
    setAddMessage(null);

    try {
      const response = await fetch("/api/price-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addValues),
        cache: "no-store",
      });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setShowAdd(false);
        setReloadKey((key) => key + 1);
        return;
      }

      if (body?.fieldErrors) {
        setAddErrors(body.fieldErrors);
      }
      if (!body?.fieldErrors || Object.keys(body.fieldErrors).length === 0) {
        setAddMessage(body?.message ?? "Unable to add the price list.");
      }
    } catch {
      setAddMessage("Could not reach the server. Please try again.");
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / SAP master data / Price lists</p>
            <h1 className="mt-1 text-lg font-semibold">Price Lists</h1>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-5 md:p-9">
          <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-[#EAF5EC] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#347447]">
                  SAP price master
                </span>
                <span className="text-xs text-[#89948D]">Prices kept as history</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Price lists</h2>
              <p className="mt-1 text-sm text-[#7D8981]">
                The SAP price lists customers are assigned to, and the entries each one carries.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/price-lists/import"
                className="flex items-center justify-center gap-2 rounded-lg border border-[#DCE5DC] bg-white px-4 py-2.5 text-sm font-medium text-[#315C43] transition hover:bg-[#EFF4EF]"
              >
                <Upload size={16} />
                Import from SAP
              </Link>
              <button
                onClick={openAddModal}
                className="flex items-center justify-center gap-2 rounded-lg bg-[#183D2D] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#24543D]"
              >
                <Plus size={17} />
                Add price list
              </button>
            </div>
          </div>

          <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Price lists", value: formatNumber(stats?.totalLists), icon: Tags, note: "Lists in SalesFlow" },
              { label: "Price entries", value: formatNumber(stats?.totalEntries), icon: Receipt, note: "Across all lists" },
              { label: "Customers assigned", value: formatNumber(stats?.customersAssigned), icon: Users, note: "Priced from a list" },
              {
                label: "Last SAP import",
                value: stats ? formatDate(stats.lastImportedAt) : "—",
                icon: Clock3,
                note: stats && stats.currencyCount > 0 ? `${stats.currencyCount} currenc${stats.currencyCount === 1 ? "y" : "ies"} in use` : "No import yet",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl border border-[#E8ECE7] bg-white p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#7D8981]">{item.label}</span>
                    <div className="rounded-lg bg-[#EFF4EF] p-2 text-[#315C43]">
                      <Icon size={18} />
                    </div>
                  </div>
                  <p className="mt-4 text-2xl font-semibold">{item.value}</p>
                  <p className="mt-1 text-xs text-[#9AA39D]">{item.note}</p>
                </div>
              );
            })}
          </div>

          <section className="overflow-hidden rounded-xl border border-[#E8ECE7] bg-white">
            <div className="flex flex-col justify-between gap-4 border-b border-[#E8ECE7] p-5 lg:flex-row lg:items-center">
              <div>
                <h3 className="font-semibold">Price lists</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  {priceLists ? `${formatNumber(filteredLists.length)} of ${formatNumber(priceLists.length)} lists shown` : "Loading price lists..."}
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-72">
                <Search size={16} className="text-[#89948D]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search code or name..."
                  maxLength={100}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-[#A3ACA6]"
                />
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

            <div className={`overflow-x-auto transition-opacity ${loading && priceLists ? "opacity-50" : "opacity-100"}`}>
              <table className="w-full min-w-[850px] text-left">
                <thead className="bg-[#FAFBF9] text-xs text-[#89948D]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Code</th>
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Currency</th>
                    <th className="px-5 py-3 font-medium">Entries</th>
                    <th className="px-5 py-3 font-medium">Customers assigned</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1ED]">
                  {filteredLists.map((list) => (
                    <tr key={list.id} className="transition hover:bg-[#FAFBF9]">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EDF3ED] text-[#315C43]">
                            <BadgeDollarSign size={17} />
                          </div>
                          <span className="font-mono text-xs font-medium">{list.code}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm">{list.name}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-[#EAF5EC] px-2.5 py-1 text-xs font-medium text-[#347447]">{list.currencyCode}</span>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#59675E]">{formatNumber(list.entryCount)}</td>
                      <td className="px-5 py-4 text-sm text-[#59675E]">{formatNumber(list.customerCount)}</td>
                      <td className="px-5 py-4 text-xs text-[#59675E]">{formatDate(list.createdAt)}</td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/price-lists/${list.id}`}
                          className="inline-flex items-center rounded-lg border border-[#E1E7E0] px-3 py-1.5 text-xs font-medium text-[#315C43] hover:bg-[#EFF4EF]"
                        >
                          View entries
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {!loading && !error && filteredLists.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-sm text-[#89948D]">
                        {priceLists && priceLists.length > 0 ? "No price lists match your search." : "No price lists yet. Add one or import from SAP."}
                      </td>
                    </tr>
                  )}

                  {loading && !priceLists && (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-sm text-[#89948D]">
                        Loading price lists...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="border-t border-[#E8ECE7] px-5 py-3 text-xs text-[#9AA39D]">
              Prices are kept as history, not overwritten -- a price change is a new entry, never an edit to an old
              one. Entry counts include every validity period on record, not just the one in effect today.
            </p>
          </section>
        </div>
      </main>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Add price list</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  Creates an empty price list. Add entries afterwards from its page, or by importing from SAP.
                </p>
              </div>
              <button
                onClick={() => setShowAdd(false)}
                disabled={addSaving}
                className="rounded-lg p-2 text-[#89948D] hover:bg-[#F1F3F0]"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={submitAdd} className="space-y-4">
              {addMessage && (
                <div className="flex items-start gap-2 rounded-lg border border-[#F1D9D9] bg-[#FFF6F6] px-3 py-2 text-sm text-[#9B3B3B]">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <p>{addMessage}</p>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium">Code</label>
                <input
                  value={addValues.code}
                  onChange={(event) => setAddValues((v) => ({ ...v, code: event.target.value }))}
                  maxLength={50}
                  placeholder="e.g. RETAIL-USD"
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${addErrors.code ? "border-[#E7C4C4]" : "border-[#E5EAE4]"}`}
                />
                {addErrors.code && <p className="mt-1 text-xs text-[#9B3B3B]">{addErrors.code}</p>}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <input
                  value={addValues.name}
                  onChange={(event) => setAddValues((v) => ({ ...v, name: event.target.value }))}
                  maxLength={200}
                  placeholder="e.g. Retail price list"
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${addErrors.name ? "border-[#E7C4C4]" : "border-[#E5EAE4]"}`}
                />
                {addErrors.name && <p className="mt-1 text-xs text-[#9B3B3B]">{addErrors.name}</p>}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Currency</label>
                <select
                  value={addValues.currencyCode}
                  onChange={(event) => setAddValues((v) => ({ ...v, currencyCode: event.target.value }))}
                  className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none ${addErrors.currencyCode ? "border-[#E7C4C4]" : "border-[#E5EAE4]"}`}
                >
                  <option value="USD">USD</option>
                  <option value="ZWG">ZWG</option>
                </select>
                {addErrors.currencyCode && <p className="mt-1 text-xs text-[#9B3B3B]">{addErrors.currencyCode}</p>}
              </div>

              <div className="flex justify-end gap-3 border-t border-[#EEF1ED] pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  disabled={addSaving}
                  className="rounded-lg border border-[#E1E7E0] px-4 py-2.5 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="rounded-lg bg-[#183D2D] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#24543D] disabled:opacity-60"
                >
                  {addSaving ? "Saving..." : "Add price list"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
