
"use client";

import { useMemo, useState } from "react";
import {
  Eye,
  Search,
  Package,
  Warehouse,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Filter,
  MapPin,
  RefreshCw,
  X,
  Boxes,
  TrendingDown,
} from "lucide-react";
import Sidebar from "../components/sidebar";

type StockItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  warehouse: string;
  reorderLevel: number;
  updatedAt: string;
};

const initialStock: StockItem[] = [
  {
    id: "1",
    code: "DEMO-PRD-001",
    name: "Apples Golden Delicious",
    category: "Fruit",
    quantity: 850,
    unit: "KG",
    warehouse: "Cold Room A",
    reorderLevel: 200,
    updatedAt: "03 Nov 2026, 08:30",
  },
  {
    id: "2",
    code: "DEMO-PRD-002",
    name: "Apples Red",
    category: "Fruit",
    quantity: 420,
    unit: "KG",
    warehouse: "Cold Room A",
    reorderLevel: 150,
    updatedAt: "03 Nov 2026, 08:25",
  },
  {
    id: "3",
    code: "DEMO-PRD-003",
    name: "Avocado",
    category: "Fruit",
    quantity: 95,
    unit: "KG",
    warehouse: "Cold Room B",
    reorderLevel: 120,
    updatedAt: "03 Nov 2026, 08:20",
  },
  {
    id: "4",
    code: "DEMO-PRD-004",
    name: "Blueberries",
    category: "Fruit",
    quantity: 38,
    unit: "PUNNET",
    warehouse: "Cold Room B",
    reorderLevel: 40,
    updatedAt: "03 Nov 2026, 08:15",
  },
  {
    id: "5",
    code: "DEMO-PRD-005",
    name: "Oranges",
    category: "Fruit",
    quantity: 1200,
    unit: "KG",
    warehouse: "Cold Room A",
    reorderLevel: 300,
    updatedAt: "03 Nov 2026, 08:10",
  },
  {
    id: "6",
    code: "DEMO-PRD-006",
    name: "Broccoli",
    category: "Vegetables",
    quantity: 65,
    unit: "EACH",
    warehouse: "Cold Room C",
    reorderLevel: 100,
    updatedAt: "03 Nov 2026, 08:05",
  },
  {
    id: "7",
    code: "DEMO-PRD-007",
    name: "Carrots",
    category: "Vegetables",
    quantity: 560,
    unit: "KG",
    warehouse: "Cold Room C",
    reorderLevel: 150,
    updatedAt: "03 Nov 2026, 07:55",
  },
  {
    id: "8",
    code: "DEMO-PRD-008",
    name: "Potatoes",
    category: "Vegetables",
    quantity: 1800,
    unit: "KG",
    warehouse: "Warehouse 1",
    reorderLevel: 400,
    updatedAt: "03 Nov 2026, 07:50",
  },
  {
    id: "9",
    code: "DEMO-PRD-009",
    name: "Cauliflower",
    category: "Vegetables",
    quantity: 45,
    unit: "EACH",
    warehouse: "Cold Room C",
    reorderLevel: 80,
    updatedAt: "03 Nov 2026, 07:45",
  },
  {
    id: "10",
    code: "DEMO-PRD-010",
    name: "Green Peppers",
    category: "Vegetables",
    quantity: 240,
    unit: "KG",
    warehouse: "Cold Room C",
    reorderLevel: 100,
    updatedAt: "03 Nov 2026, 07:40",
  },
  {
    id: "11",
    code: "DEMO-PRD-011",
    name: "Cucumbers",
    category: "Vegetables",
    quantity: 0,
    unit: "KG",
    warehouse: "Cold Room C",
    reorderLevel: 100,
    updatedAt: "03 Nov 2026, 07:35",
  },
  {
    id: "12",
    code: "DEMO-PRD-012",
    name: "Strawberries",
    category: "Fruit",
    quantity: 22,
    unit: "PUNNET",
    warehouse: "Cold Room B",
    reorderLevel: 35,
    updatedAt: "03 Nov 2026, 07:30",
  },
  {
    id: "13",
    code: "DEMO-PRD-013",
    name: "Celery",
    category: "Vegetables",
    quantity: 110,
    unit: "EACH",
    warehouse: "Cold Room C",
    reorderLevel: 50,
    updatedAt: "03 Nov 2026, 07:25",
  },
  {
    id: "14",
    code: "DEMO-PRD-014",
    name: "Lemons",
    category: "Fruit",
    quantity: 160,
    unit: "KG",
    warehouse: "Cold Room A",
    reorderLevel: 80,
    updatedAt: "03 Nov 2026, 07:20",
  },
];

function getStockStatus(item: StockItem) {
  if (item.quantity <= 0) return "Out of stock";
  if (item.quantity <= item.reorderLevel) return "Low stock";
  return "Available";
}

export default function StockPage() {
  const [stock, setStock] = useState(initialStock);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [warehouseFilter, setWarehouseFilter] = useState("All");
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);

  const filteredStock = useMemo(() => {
    return stock.filter((item) => {
      const query = search.toLowerCase();

      const matchesSearch =
        item.name.toLowerCase().includes(query) ||
        item.code.toLowerCase().includes(query);

      const matchesCategory =
        categoryFilter === "All" || item.category === categoryFilter;

      const matchesWarehouse =
        warehouseFilter === "All" || item.warehouse === warehouseFilter;

      const status = getStockStatus(item);
      const matchesStatus =
        statusFilter === "All" || status === statusFilter;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesWarehouse &&
        matchesStatus
      );
    });
  }, [stock, search, categoryFilter, statusFilter, warehouseFilter]);

  const availableCount = stock.filter(
    (item) => getStockStatus(item) === "Available"
  ).length;

  const lowStockCount = stock.filter(
    (item) => getStockStatus(item) === "Low stock"
  ).length;

  const outOfStockCount = stock.filter(
    (item) => getStockStatus(item) === "Out of stock"
  ).length;

  const totalUnits = stock.reduce(
    (total, item) => total + item.quantity,
    0
  );

  const warehouses = Array.from(
    new Set(stock.map((item) => item.warehouse))
  );

  function refreshSnapshot() {
    setStock((previous) => [...previous]);
  }

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">
              Workspace / Stock in Hand
            </p>
            <h1 className="mt-1 text-lg font-semibold">
              Stock in Hand
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-[#E8ECE7] bg-[#FAFBF9] px-3 py-2 text-sm text-[#89948D] md:flex">
              <Search size={16} />
              <span>Search workspace</span>
              <span className="ml-5 rounded border bg-white px-1.5 py-0.5 text-xs">
                /
              </span>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF0E9] text-sm font-semibold text-[#315C43]">
              SA
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-5 md:p-9">
          <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-[#FFF4D9] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#98712B]">
                  Demo snapshot
                </span>
                <span className="text-xs text-[#89948D]">
                  Inventory visibility
                </span>
              </div>

              <h2 className="text-2xl font-semibold tracking-tight">
                Stock availability
              </h2>

              <p className="mt-1 text-sm text-[#7D8981]">
                View illustrative produce quantities and warehouse locations.
              </p>
            </div>

            <button
              onClick={refreshSnapshot}
              className="flex items-center justify-center gap-2 rounded-lg border border-[#DDE5DC] bg-white px-4 py-2.5 text-sm font-medium text-[#315C43] transition hover:bg-[#EFF4EF]"
            >
              <RefreshCw size={16} />
              Refresh view
            </button>
          </div>

          <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Product records",
                value: stock.length,
                icon: Package,
                note: "Products in this snapshot",
              },
              {
                label: "Available products",
                value: availableCount,
                icon: CheckCircle2,
                note: "Above reorder level",
              },
              {
                label: "Low stock",
                value: lowStockCount,
                icon: AlertTriangle,
                note: "At or below reorder level",
              },
              {
                label: "Out of stock",
                value: outOfStockCount,
                icon: TrendingDown,
                note: "Zero recorded quantity",
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

                  <p className="mt-4 text-2xl font-semibold">
                    {item.value}
                  </p>

                  <p className="mt-1 text-xs text-[#9AA39D]">
                    {item.note}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-[#E8ECE7] bg-white p-5 lg:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[#7D8981]">
                    Recorded quantity
                  </p>
                  <p className="mt-2 text-3xl font-semibold">
                    {totalUnits.toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-[#9AA39D]">
                    Sum of quantities across different units of measurement
                  </p>
                </div>

                <div className="rounded-xl bg-[#EFF4EF] p-3 text-[#315C43]">
                  <Boxes size={24} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#E8ECE7] bg-white p-5">
              <div className="flex items-center gap-2">
                <Warehouse size={18} className="text-[#315C43]" />
                <p className="text-sm font-medium">Storage locations</p>
              </div>

              <p className="mt-2 text-3xl font-semibold">
                {warehouses.length}
              </p>

              <p className="mt-1 text-xs text-[#9AA39D]">
                Locations represented in this demo
              </p>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-[#E8ECE7] bg-white">
            <div className="flex flex-col justify-between gap-4 border-b border-[#E8ECE7] p-5 xl:flex-row xl:items-center">
              <div>
                <h3 className="font-semibold">Inventory records</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  {filteredStock.length} products displayed
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-60">
                  <Search size={16} className="text-[#89948D]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search stock..."
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#A3ACA6]"
                  />
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3">
                  <Filter size={15} className="text-[#89948D]" />
                  <select
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                    className="bg-transparent py-2 text-sm outline-none"
                  >
                    <option value="All">All categories</option>
                    <option value="Fruit">Fruit</option>
                    <option value="Vegetables">Vegetables</option>
                  </select>
                </div>

                <select
                  value={warehouseFilter}
                  onChange={(event) => setWarehouseFilter(event.target.value)}
                  className="rounded-lg border border-[#E5EAE4] bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="All">All locations</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse} value={warehouse}>
                      {warehouse}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-5 border-b border-[#E8ECE7] px-5">
              {["All", "Available", "Low stock", "Out of stock"].map(
                (status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`whitespace-nowrap border-b-2 py-3 text-sm transition ${
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

            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-left">
                <thead className="bg-[#FAFBF9] text-xs text-[#89948D]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Product</th>
                    <th className="px-5 py-3 font-medium">Product code</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Quantity</th>
                    <th className="px-5 py-3 font-medium">Reorder level</th>
                    <th className="px-5 py-3 font-medium">Location</th>
                    <th className="px-5 py-3 font-medium">Availability</th>
                    <th className="px-5 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#EEF1ED]">
                  {filteredStock.map((item) => {
                    const status = getStockStatus(item);

                    return (
                      <tr
                        key={item.id}
                        className="transition hover:bg-[#FAFBF9]"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EDF3ED] text-[#315C43]">
                              <Package size={17} />
                            </div>
                            <span className="text-sm font-medium">
                              {item.name}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-4 text-xs text-[#7D8981]">
                          {item.code}
                        </td>

                        <td className="px-5 py-4 text-sm text-[#59675E]">
                          {item.category}
                        </td>

                        <td className="px-5 py-4">
                          <span className="text-sm font-semibold">
                            {item.quantity.toLocaleString()}
                          </span>
                          <span className="ml-1 text-xs text-[#89948D]">
                            {item.unit}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-sm text-[#7D8981]">
                          {item.reorderLevel.toLocaleString()} {item.unit}
                        </td>

                        <td className="px-5 py-4 text-sm text-[#59675E]">
                          <div className="flex items-center gap-1.5">
                            <MapPin size={14} className="text-[#89948D]" />
                            {item.warehouse}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              status === "Available"
                                ? "bg-[#EAF5EC] text-[#347447]"
                                : status === "Low stock"
                                  ? "bg-[#FFF4D9] text-[#98712B]"
                                  : "bg-[#FDECEC] text-[#B34B4B]"
                            }`}
                          >
                            {status}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => setSelectedItem(item)}
                            title="View stock details"
                            className="rounded-lg p-2 text-[#89948D] hover:bg-[#EFF4EF] hover:text-[#315C43]"
                          >
                            <Eye size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredStock.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-5 py-12 text-center text-sm text-[#89948D]"
                      >
                        No stock records match your search or filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col justify-between gap-2 border-t border-[#E8ECE7] px-5 py-4 text-xs text-[#89948D] sm:flex-row">
              <span>
                Showing {filteredStock.length} of {stock.length} products
              </span>
              <span>
                Illustrative quantities only · Not connected to SAP
              </span>
            </div>
          </section>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#E8E6D9] bg-[#FFFDF5] p-4">
            <AlertTriangle
              size={19}
              className="mt-0.5 shrink-0 text-[#8A783D]"
            />
            <div>
              <p className="text-sm font-medium text-[#6D6037]">
                Stock availability is not a reservation
              </p>
              <p className="mt-1 text-xs leading-5 text-[#887B54]">
                This page displays a demonstration snapshot. Stock can change
                after a customer order is received. Sales must verify current
                availability before confirming quantities or approving an
                order. No stock is reserved or deducted by this page.
              </p>
            </div>
          </div>
        </div>
      </main>

      {selectedItem && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-7 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Stock details</h3>
              <button
                onClick={() => setSelectedItem(null)}
                className="rounded-lg p-2 text-[#89948D] hover:bg-[#F1F3F0]"
              >
                <X size={19} />
              </button>
            </div>

            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EDF3ED] text-[#315C43]">
                <Package size={22} />
              </div>

              <div>
                <h4 className="font-semibold">{selectedItem.name}</h4>
                <p className="text-xs text-[#89948D]">
                  {selectedItem.code}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4">
              <p className="text-xs text-[#89948D]">Recorded quantity</p>
              <p className="mt-1 text-3xl font-semibold">
                {selectedItem.quantity.toLocaleString()}
                <span className="ml-2 text-sm font-medium text-[#89948D]">
                  {selectedItem.unit}
                </span>
              </p>

              <span
                className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                  getStockStatus(selectedItem) === "Available"
                    ? "bg-[#EAF5EC] text-[#347447]"
                    : getStockStatus(selectedItem) === "Low stock"
                      ? "bg-[#FFF4D9] text-[#98712B]"
                      : "bg-[#FDECEC] text-[#B34B4B]"
                }`}
              >
                {getStockStatus(selectedItem)}
              </span>
            </div>

            <div className="mt-6 space-y-5">
              {[
                { label: "Category", value: selectedItem.category },
                { label: "Warehouse", value: selectedItem.warehouse },
                {
                  label: "Reorder level",
                  value: `${selectedItem.reorderLevel} ${selectedItem.unit}`,
                },
                { label: "Last updated", value: selectedItem.updatedAt },
              ].map((detail) => (
                <div key={detail.label}>
                  <p className="text-xs text-[#89948D]">{detail.label}</p>
                  <p className="mt-1 text-sm font-medium">
                    {detail.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-xl border border-[#E8E6D9] bg-[#FFFDF5] p-4">
              <div className="flex items-center gap-2">
                <Clock3 size={17} className="text-[#8A783D]" />
                <p className="text-sm font-medium text-[#6D6037]">
                  Snapshot information
                </p>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#887B54]">
                This is illustrative data. It is not a live warehouse balance
                and must not be used as confirmation of available stock.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
