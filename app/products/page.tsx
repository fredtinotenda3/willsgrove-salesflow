
"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Plus,
  Package,
  Leaf,
  Apple,
  Carrot,
  Filter,
  X,
  Eye,
  CheckCircle2,
  Clock3,
  Tag,
  Scale,
  Boxes,
} from "lucide-react";
import Sidebar from "../components/sidebar";

type Product = {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  packSize: string;
  description: string;
  status: "Active" | "Inactive";
};

const initialProducts: Product[] = [
  {
    id: "1",
    code: "DEMO-PRD-001",
    name: "Apples Golden Delicious",
    category: "Fruit",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Golden Delicious apples. Product specification to be confirmed.",
    status: "Active",
  },
  {
    id: "2",
    code: "DEMO-PRD-002",
    name: "Apples Red",
    category: "Fruit",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Red apples. Product grade and variety to be confirmed.",
    status: "Active",
  },
  {
    id: "3",
    code: "DEMO-PRD-003",
    name: "Avocado",
    category: "Fruit",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Fresh avocado. Size and grade to be confirmed.",
    status: "Active",
  },
  {
    id: "4",
    code: "DEMO-PRD-004",
    name: "Blueberries",
    category: "Fruit",
    unit: "PUNNET",
    packSize: "Pack size to be confirmed",
    description: "Fresh blueberries. Pack specification to be confirmed.",
    status: "Active",
  },
  {
    id: "5",
    code: "DEMO-PRD-005",
    name: "Oranges",
    category: "Fruit",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Fresh oranges. Variety and grade to be confirmed.",
    status: "Active",
  },
  {
    id: "6",
    code: "DEMO-PRD-006",
    name: "Broccoli",
    category: "Vegetables",
    unit: "EACH",
    packSize: "Per piece",
    description: "Fresh broccoli. Size and grade to be confirmed.",
    status: "Active",
  },
  {
    id: "7",
    code: "DEMO-PRD-007",
    name: "Carrots",
    category: "Vegetables",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Fresh carrots. Grade to be confirmed.",
    status: "Active",
  },
  {
    id: "8",
    code: "DEMO-PRD-008",
    name: "Potatoes",
    category: "Vegetables",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Fresh potatoes. Variety and grade to be confirmed.",
    status: "Active",
  },
  {
    id: "9",
    code: "DEMO-PRD-009",
    name: "Cauliflower",
    category: "Vegetables",
    unit: "EACH",
    packSize: "Per piece",
    description: "Fresh cauliflower. Size and grade to be confirmed.",
    status: "Active",
  },
  {
    id: "10",
    code: "DEMO-PRD-010",
    name: "Green Peppers",
    category: "Vegetables",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Fresh green peppers. Grade to be confirmed.",
    status: "Active",
  },
  {
    id: "11",
    code: "DEMO-PRD-011",
    name: "Cucumbers",
    category: "Vegetables",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Fresh cucumbers. Size and grade to be confirmed.",
    status: "Active",
  },
  {
    id: "12",
    code: "DEMO-PRD-012",
    name: "Strawberries",
    category: "Fruit",
    unit: "PUNNET",
    packSize: "Pack size to be confirmed",
    description: "Fresh strawberries. Pack specification to be confirmed.",
    status: "Active",
  },
  {
    id: "13",
    code: "DEMO-PRD-013",
    name: "Celery",
    category: "Vegetables",
    unit: "EACH",
    packSize: "Per piece",
    description: "Fresh celery. Grade to be confirmed.",
    status: "Active",
  },
  {
    id: "14",
    code: "DEMO-PRD-014",
    name: "Lemons",
    category: "Fruit",
    unit: "KG",
    packSize: "Per kilogram",
    description: "Fresh lemons. Grade to be confirmed.",
    status: "Inactive",
  },
];

const categories = ["All", "Fruit", "Vegetables", "Other"];

export default function ProductsPage() {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "Fruit",
    unit: "KG",
    packSize: "",
    description: "",
  });

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const query = search.toLowerCase();

      const matchesSearch =
        product.name.toLowerCase().includes(query) ||
        product.code.toLowerCase().includes(query);

      const matchesCategory =
        categoryFilter === "All" ||
        product.category === categoryFilter;

      const matchesStatus =
        statusFilter === "All" ||
        product.status === statusFilter;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [products, search, categoryFilter, statusFilter]);

  const activeCount = products.filter(
    (product) => product.status === "Active"
  ).length;

  const fruitCount = products.filter(
    (product) => product.category === "Fruit"
  ).length;

  const vegetableCount = products.filter(
    (product) => product.category === "Vegetables"
  ).length;

  function handleAddProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const newProduct: Product = {
      id: Date.now().toString(),
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      unit: form.unit,
      packSize: form.packSize.trim() || "Not configured",
      description: form.description.trim() || "No description provided.",
      status: "Active",
    };

    setProducts((previous) => [...previous, newProduct]);

    setForm({
      code: "",
      name: "",
      category: "Fruit",
      unit: "KG",
      packSize: "",
      description: "",
    });

    setShowForm(false);
  }

  function toggleProductStatus(id: string) {
    setProducts((previous) =>
      previous.map((product) =>
        product.id === id
          ? {
              ...product,
              status:
                product.status === "Active" ? "Inactive" : "Active",
            }
          : product
      )
    );

    setSelectedProduct(null);
  }

  function categoryIcon(category: string) {
    if (category === "Fruit") return Apple;
    if (category === "Vegetables") return Carrot;
    return Package;
  }

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">
              Workspace / Products
            </p>
            <h1 className="mt-1 text-lg font-semibold">
              Products
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
                  Demo data
                </span>
                <span className="text-xs text-[#89948D]">
                  Product catalogue
                </span>
              </div>

              <h2 className="text-2xl font-semibold tracking-tight">
                Product management
              </h2>

              <p className="mt-1 text-sm text-[#7D8981]">
                Manage produce descriptions, product codes, categories and units.
              </p>
            </div>

            <button
              onClick={() => setShowForm(true)}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#183D2D] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#24543D]"
            >
              <Plus size={17} />
              Add Product
            </button>
          </div>

          <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Total products",
                value: products.length,
                icon: Package,
                note: "Catalogue records",
              },
              {
                label: "Active products",
                value: activeCount,
                icon: CheckCircle2,
                note: "Available for selection",
              },
              {
                label: "Fruit products",
                value: fruitCount,
                icon: Apple,
                note: "Fruit category",
              },
              {
                label: "Vegetable products",
                value: vegetableCount,
                icon: Carrot,
                note: "Vegetable category",
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

          <section className="overflow-hidden rounded-xl border border-[#E8ECE7] bg-white">
            <div className="flex flex-col justify-between gap-4 border-b border-[#E8ECE7] p-5 lg:flex-row lg:items-center">
              <div>
                <h3 className="font-semibold">Product catalogue</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  {filteredProducts.length} products displayed
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-64">
                  <Search size={16} className="text-[#89948D]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search code or product..."
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#A3ACA6]"
                  />
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3">
                  <Filter size={15} className="text-[#89948D]" />

                  <select
                    value={categoryFilter}
                    onChange={(event) =>
                      setCategoryFilter(event.target.value)
                    }
                    className="bg-transparent py-2 text-sm outline-none"
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category === "All" ? "All categories" : category}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-5 border-b border-[#E8ECE7] px-5">
              {["All", "Active", "Inactive"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`border-b-2 py-3 text-sm transition ${
                    statusFilter === status
                      ? "border-[#315C43] font-semibold text-[#315C43]"
                      : "border-transparent text-[#89948D] hover:text-[#315C43]"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left">
                <thead className="bg-[#FAFBF9] text-xs text-[#89948D]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Product</th>
                    <th className="px-5 py-3 font-medium">Product code</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Unit</th>
                    <th className="px-5 py-3 font-medium">Pack size</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#EEF1ED]">
                  {filteredProducts.map((product) => {
                    const Icon = categoryIcon(product.category);

                    return (
                      <tr
                        key={product.id}
                        className="transition hover:bg-[#FAFBF9]"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EDF3ED] text-[#315C43]">
                              <Icon size={17} />
                            </div>

                            <span className="text-sm font-medium">
                              {product.name}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-4 text-xs text-[#7D8981]">
                          {product.code}
                        </td>

                        <td className="px-5 py-4 text-sm text-[#59675E]">
                          {product.category}
                        </td>

                        <td className="px-5 py-4">
                          <span className="rounded-md bg-[#F1F4F0] px-2 py-1 text-xs font-medium text-[#526158]">
                            {product.unit}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-sm text-[#7D8981]">
                          {product.packSize}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              product.status === "Active"
                                ? "bg-[#EAF5EC] text-[#347447]"
                                : "bg-[#F1F2F0] text-[#778078]"
                            }`}
                          >
                            {product.status}
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
                    );
                  })}

                  {filteredProducts.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-12 text-center text-sm text-[#89948D]"
                      >
                        No products match your search or filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col justify-between gap-2 border-t border-[#E8ECE7] px-5 py-4 text-xs text-[#89948D] sm:flex-row">
              <span>
                Showing {filteredProducts.length} of {products.length} products
              </span>
              <span>
                Illustrative records only · Not connected to SAP
              </span>
            </div>
          </section>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#E8E6D9] bg-[#FFFDF5] p-4">
            <Leaf size={19} className="mt-0.5 shrink-0 text-[#8A783D]" />
            <div>
              <p className="text-sm font-medium text-[#6D6037]">
                Product code and unit accuracy
              </p>
              <p className="mt-1 text-xs leading-5 text-[#887B54]">
                Similar produce descriptions are not necessarily the same
                product. Grades, varieties, pack sizes and units must be
                verified against Willsgrove's actual SAP Business One
                catalogue before an order is processed.
              </p>
            </div>
          </div>
        </div>
      </main>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Add product</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  Add an illustrative catalogue record.
                </p>
              </div>

              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg p-2 text-[#89948D] hover:bg-[#F1F3F0]"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={handleAddProduct} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Product name *
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="e.g. Fresh Green Peppers"
                  className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none focus:border-[#315C43]"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Product code *
                </label>
                <input
                  required
                  value={form.code}
                  onChange={(event) =>
                    setForm({ ...form, code: event.target.value })
                  }
                  placeholder="Enter a unique demo code"
                  className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none focus:border-[#315C43]"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Category
                  </label>
                  <select
                    value={form.category}
                    onChange={(event) =>
                      setForm({ ...form, category: event.target.value })
                    }
                    className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
                  >
                    <option>Fruit</option>
                    <option>Vegetables</option>
                    <option>Other</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Unit of measurement
                  </label>
                  <select
                    value={form.unit}
                    onChange={(event) =>
                      setForm({ ...form, unit: event.target.value })
                    }
                    className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
                  >
                    <option value="KG">Kilogram (KG)</option>
                    <option value="EACH">Each (EACH)</option>
                    <option value="BOX">Box (BOX)</option>
                    <option value="PUNNET">Punnet</option>
                    <option value="BUNCH">Bunch</option>
                    <option value="PACK">Pack</option>
                    <option value="CRATE">Crate</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Pack size / selling format
                </label>
                <input
                  value={form.packSize}
                  onChange={(event) =>
                    setForm({ ...form, packSize: event.target.value })
                  }
                  placeholder="e.g. 1.5KG, per kilogram, per piece"
                  className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  rows={3}
                  placeholder="Optional product details..."
                  className="w-full resize-none rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-[#EEF1ED] pt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-[#E1E7E0] px-4 py-2.5 text-sm font-medium"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="rounded-lg bg-[#183D2D] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#24543D]"
                >
                  Add product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EDF3ED] text-[#315C43]">
                <Package size={22} />
              </div>

              <div>
                <h4 className="font-semibold">{selectedProduct.name}</h4>
                <p className="text-xs text-[#89948D]">
                  {selectedProduct.code}
                </p>
              </div>
            </div>

            <div className="space-y-5">
              {[
                {
                  label: "Category",
                  value: selectedProduct.category,
                  icon: Tag,
                },
                {
                  label: "Unit of measurement",
                  value: selectedProduct.unit,
                  icon: Scale,
                },
                {
                  label: "Pack size / format",
                  value: selectedProduct.packSize,
                  icon: Boxes,
                },
                {
                  label: "Description",
                  value: selectedProduct.description,
                  icon: Leaf,
                },
              ].map((detail) => {
                const Icon = detail.icon;

                return (
                  <div key={detail.label} className="flex gap-3">
                    <Icon size={17} className="mt-0.5 text-[#89948D]" />
                    <div>
                      <p className="text-xs text-[#89948D]">
                        {detail.label}
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {detail.value}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4">
              <p className="text-sm font-semibold">Product status</p>
              <p className="mt-1 text-sm text-[#89948D]">
                This product is currently {selectedProduct.status.toLowerCase()}.
              </p>

              <button
                onClick={() => toggleProductStatus(selectedProduct.id)}
                className="mt-4 w-full rounded-lg border border-[#DCE5DC] bg-white px-4 py-2.5 text-sm font-medium text-[#315C43] hover:bg-[#EFF4EF]"
              >
                {selectedProduct.status === "Active"
                  ? "Deactivate product"
                  : "Activate product"}
              </button>
            </div>

            <p className="mt-6 text-xs leading-5 text-[#9AA39D]">
              Demo product profile. Approved selling prices, stock balances
              and SAP product-code matching will be added in later stages.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
