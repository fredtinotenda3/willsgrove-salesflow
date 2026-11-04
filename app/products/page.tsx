"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Package,
  Leaf,
  Filter,
  X,
  Eye,
  CheckCircle2,
  Clock3,
  Tag,
  Boxes,
} from "lucide-react";
import Link from "next/link";
import Sidebar from "../components/sidebar";

const PAGE_SIZE = 50;

type ApiProduct = {
  id: string;
  sapItemCode: string;
  itemName: string;
  barcode: string | null;
  category: string | null;
  status: "ACTIVE" | "INACTIVE";
  importedAt: string | null;
  unusableSourceBarcode: string | null;
};

type ProductsResponse = {
  success: true;
  products: ApiProduct[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  categories: { name: string; count: number }[];
  stats: {
    total: number;
    active: number;
    inactive: number;
    itemGroups: number;
    withBarcode: number;
  };
};

type StatusFilter = "All" | "Active" | "Inactive";

function formatNumber(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString("en-GB");
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";

  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status: ApiProduct["status"]) {
  return status === "ACTIVE" ? "Active" : "Inactive";
}

export default function ProductsPage() {
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [page, setPage] = useState(1);

  const [selectedProduct, setSelectedProduct] =
    useState<ApiProduct | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProducts() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });

      if (debouncedSearch) params.set("search", debouncedSearch);
      if (categoryFilter !== "All") params.set("category", categoryFilter);
      if (statusFilter !== "All") {
        params.set("status", statusFilter.toUpperCase());
      }

      try {
        const response = await fetch(`/api/products?${params.toString()}`, {
          signal: controller.signal,
        });

        const body = await response.json();

        if (!response.ok || !body.success) {
          throw new Error(body.message ?? "Unable to load products.");
        }

        setData(body as ProductsResponse);
      } catch (loadError) {
        if (controller.signal.aborted) return;

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load products."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadProducts();

    return () => controller.abort();
  }, [page, debouncedSearch, categoryFilter, statusFilter, reloadKey]);

  const products = data?.products ?? [];
  const pagination = data?.pagination;
  const stats = data?.stats;
  const categories = data?.categories ?? [];

  const firstShown =
    pagination && pagination.totalItems > 0
      ? (pagination.page - 1) * pagination.pageSize + 1
      : 0;

  const lastShown = pagination
    ? Math.min(
        pagination.page * pagination.pageSize,
        pagination.totalItems
      )
    : 0;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-65">
        <header className="flex h-19 items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / Products</p>
            <h1 className="mt-1 text-lg font-semibold">Products</h1>
          </div>

          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF0E9] text-sm font-semibold text-[#315C43]">
            SA
          </div>
        </header>

        <div className="mx-auto max-w-375 p-5 md:p-9">
          <div className="mb-7">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-[#EAF5EC] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#347447]">
                SAP product master
              </span>
              <span className="text-xs text-[#89948D]">Read-only</span>
            </div>

            <h2 className="text-2xl font-semibold tracking-tight">
              Product catalogue
            </h2>

            <p className="mt-1 text-sm text-[#7D8981]">
              Products imported from the SAP Business One product export.
            </p>

            <Link
              href="/products/import"
              className="mt-4 inline-flex items-center rounded-lg bg-[#315C43] px-4 py-2 text-sm font-medium text-white hover:bg-[#274D37]"
            >
              Import from SAP
            </Link>
          </div>

          <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Total products",
                value: formatNumber(stats?.total),
                icon: Package,
                note: "Catalogue records",
              },
              {
                label: "Active products",
                value: formatNumber(stats?.active),
                icon: CheckCircle2,
                note: "Available for selection",
              },
              {
                label: "Item groups",
                value: formatNumber(stats?.itemGroups),
                icon: Tag,
                note: "SAP item groups",
              },
              {
                label: "With barcode",
                value: formatNumber(stats?.withBarcode),
                icon: Boxes,
                note: "Valid numeric barcode",
              },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.label}
                  className="rounded-xl border border-[#E8ECE7] bg-white p-5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#7D8981]">
                      {item.label}
                    </span>

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
                <h3 className="font-semibold">Products</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  {pagination
                    ? `${formatNumber(pagination.totalItems)} products match`
                    : "Loading products..."}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-72">
                  <Search size={16} className="text-[#89948D]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search description, code or barcode..."
                    maxLength={100}
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#A3ACA6]"
                  />
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3">
                  <Filter size={15} className="text-[#89948D]" />

                  <select
                    value={categoryFilter}
                    onChange={(event) => {
                      setCategoryFilter(event.target.value);
                      setPage(1);
                    }}
                    className="max-w-[220px] bg-transparent py-2 text-sm outline-none"
                  >
                    <option value="All">All item groups</option>
                    {categories.map((category) => (
                      <option key={category.name} value={category.name}>
                        {category.name} ({category.count})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-5 border-b border-[#E8ECE7] px-5">
              {(["All", "Active", "Inactive"] as StatusFilter[]).map(
                (status) => (
                  <button
                    key={status}
                    onClick={() => {
                      setStatusFilter(status);
                      setPage(1);
                    }}
                    className={`border-b-2 py-3 text-sm transition ${
                      statusFilter === status
                        ? "border-[#315C43] font-semibold text-[#315C43]"
                        : "border-transparent text-[#89948D] hover:text-[#315C43]"
                    }`}
                  >
                    {status}
                  </button>
                )
              )}
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

            <div
              className={`overflow-x-auto transition-opacity ${
                loading && data ? "opacity-50" : "opacity-100"
              }`}
            >
              <table className="w-full min-w-[850px] text-left">
                <thead className="bg-[#FAFBF9] text-xs text-[#89948D]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Product</th>
                    <th className="px-5 py-3 font-medium">SAP code</th>
                    <th className="px-5 py-3 font-medium">Item group</th>
                    <th className="px-5 py-3 font-medium">Barcode</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#EEF1ED]">
                  {products.map((product) => (
                    <tr
                      key={product.id}
                      className="transition hover:bg-[#FAFBF9]"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EDF3ED] text-[#315C43]">
                            <Package size={17} />
                          </div>

                          {product.itemName ? (
                            <span className="text-sm font-medium">
                              {product.itemName}
                            </span>
                          ) : (
                            <span className="text-sm italic text-[#A3ACA6]">
                              No description
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-4 font-mono text-xs text-[#59675E]">
                        {product.sapItemCode}
                      </td>

                      <td className="px-5 py-4 text-sm text-[#59675E]">
                        {product.category ?? "—"}
                      </td>

                      <td className="px-5 py-4 text-xs text-[#59675E]">
                        {product.barcode ? (
                          <span className="font-mono">{product.barcode}</span>
                        ) : product.unusableSourceBarcode ? (
                          <span className="rounded-md bg-[#FFF4D9] px-2 py-1 text-[11px] font-medium text-[#98712B]">
                            Invalid in SAP
                          </span>
                        ) : (
                          <span className="text-[#A3ACA6]">—</span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            product.status === "ACTIVE"
                              ? "bg-[#EAF5EC] text-[#347447]"
                              : "bg-[#F1F2F0] text-[#778078]"
                          }`}
                        >
                          {statusLabel(product.status)}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => setSelectedProduct(product)}
                          title="View product"
                          className="rounded-lg p-2 text-[#89948D] hover:bg-[#EFF4EF] hover:text-[#315C43]"
                        >
                          <Eye size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!loading && !error && products.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-12 text-center text-sm text-[#89948D]"
                      >
                        No products match your search or filters.
                      </td>
                    </tr>
                  )}

                  {loading && !data && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-12 text-center text-sm text-[#89948D]"
                      >
                        Loading products...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col items-start justify-between gap-3 border-t border-[#E8ECE7] px-5 py-4 text-xs text-[#89948D] sm:flex-row sm:items-center">
              <span>
                {pagination && pagination.totalItems > 0
                  ? `Showing ${formatNumber(firstShown)}–${formatNumber(
                      lastShown
                    )} of ${formatNumber(pagination.totalItems)} products`
                  : "No products to show"}
              </span>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={loading || page <= 1}
                  className="rounded-lg border border-[#E1E7E0] px-3 py-1.5 font-medium text-[#315C43] hover:bg-[#EFF4EF] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>

                <span>
                  Page {formatNumber(pagination?.page ?? page)} of{" "}
                  {formatNumber(pagination?.totalPages ?? 1)}
                </span>

                <button
                  onClick={() => setPage((current) => current + 1)}
                  disabled={
                    loading ||
                    !pagination ||
                    pagination.page >= pagination.totalPages
                  }
                  className="rounded-lg border border-[#E1E7E0] px-3 py-1.5 font-medium text-[#315C43] hover:bg-[#EFF4EF] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </section>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#E8E6D9] bg-[#FFFDF5] p-4">
            <Leaf size={19} className="mt-0.5 shrink-0 text-[#8A783D]" />
            <div>
              <p className="text-sm font-medium text-[#6D6037]">
                What this catalogue contains
              </p>
              <p className="mt-1 text-xs leading-5 text-[#887B54]">
                Codes, descriptions, barcodes and item groups come from the
                SAP Business One product export. Units of measure, pack
                sizes, approved selling prices and stock balances are not part
                of that export and are not shown here. Similar descriptions
                are not necessarily the same product, so always match on the
                SAP code.
              </p>
            </div>
          </div>
        </div>
      </main>

      {selectedProduct && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-7 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Product details</h3>

              <button
                onClick={() => setSelectedProduct(null)}
                className="rounded-lg p-2 text-[#89948D] hover:bg-[#F1F3F0]"
              >
                <X size={19} />
              </button>
            </div>

            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#EDF3ED] text-[#315C43]">
                <Package size={22} />
              </div>

              <div>
                {selectedProduct.itemName ? (
                  <h4 className="font-semibold">{selectedProduct.itemName}</h4>
                ) : (
                  <h4 className="font-semibold italic text-[#A3ACA6]">
                    No description
                  </h4>
                )}
                <p className="font-mono text-xs text-[#89948D]">
                  {selectedProduct.sapItemCode}
                </p>
              </div>
            </div>

            <div className="space-y-5">
              {[
                {
                  label: "SAP item group",
                  value: selectedProduct.category ?? "Not set in SAP",
                  icon: Tag,
                },
                {
                  label: "Barcode",
                  value: selectedProduct.barcode ?? "No valid barcode",
                  icon: Boxes,
                },
                {
                  label: "Last imported from SAP",
                  value: formatDate(selectedProduct.importedAt),
                  icon: Clock3,
                },
              ].map((detail) => {
                const Icon = detail.icon;

                return (
                  <div key={detail.label} className="flex gap-3">
                    <Icon size={17} className="mt-0.5 text-[#89948D]" />
                    <div>
                      <p className="text-xs text-[#89948D]">{detail.label}</p>
                      <p className="mt-1 text-sm font-medium">
                        {detail.value}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedProduct.unusableSourceBarcode && (
              <div className="mt-6 rounded-xl border border-[#EADFC0] bg-[#FFF9E8] p-4">
                <p className="text-sm font-semibold text-[#7A5E1F]">
                  Barcode value in SAP is not usable
                </p>
                <p className="mt-1 text-xs leading-5 text-[#8C7435]">
                  SAP holds the text{" "}
                  <span className="font-mono font-semibold">
                    {selectedProduct.unusableSourceBarcode}
                  </span>{" "}
                  in the barcode field. It is not a numeric barcode, so it is
                  not used for lookups. Correct it in SAP to fix this.
                </p>
              </div>
            )}

            <div className="mt-8 rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4">
              <p className="text-sm font-semibold">Product status</p>
              <p className="mt-1 text-sm text-[#89948D]">
                This product is currently{" "}
                {statusLabel(selectedProduct.status).toLowerCase()}.
              </p>
            </div>

            <p className="mt-6 text-xs leading-5 text-[#9AA39D]">
              Read-only SAP product record. Approved selling prices, stock
              balances and units will be added in later stages.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}