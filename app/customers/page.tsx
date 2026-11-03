
"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Plus,
  Users,
  Building2,
  MapPin,
  ShoppingBag,
  MoreHorizontal,
  X,
  CheckCircle2,
  Clock3,
  UserRound,
  Mail,
  Phone,
  ArrowUpRight,
  Filter,
} from "lucide-react";
import Sidebar from "../components/sidebar";

type Customer = {
  id: string;
  name: string;
  reference: string;
  category: string;
  contact: string;
  email: string;
  phone: string;
  location: string;
  branches: number;
  status: "Active" | "Inactive";
};

const initialCustomers: Customer[] = [
  {
    id: "1",
    name: "Gweru Pick n Pay",
    reference: "DEMO-CUS-001",
    category: "Supermarket",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Gweru",
    branches: 1,
    status: "Active",
  },
  {
    id: "2",
    name: "TM Supermarket",
    reference: "DEMO-CUS-002",
    category: "Supermarket",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Not configured",
    branches: 1,
    status: "Active",
  },
  {
    id: "3",
    name: "OK Zimbabwe",
    reference: "DEMO-CUS-003",
    category: "Supermarket",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Not configured",
    branches: 1,
    status: "Active",
  },
  {
    id: "4",
    name: "SPAR Borrowdale",
    reference: "DEMO-CUS-004",
    category: "Supermarket",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Borrowdale",
    branches: 1,
    status: "Active",
  },
  {
    id: "5",
    name: "Pick n Pay Bulawayo",
    reference: "DEMO-CUS-005",
    category: "Supermarket",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Bulawayo",
    branches: 1,
    status: "Active",
  },
  {
    id: "6",
    name: "Food Lovers Market",
    reference: "DEMO-CUS-006",
    category: "Retail",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Not configured",
    branches: 1,
    status: "Active",
  },
  {
    id: "7",
    name: "Choppies",
    reference: "DEMO-CUS-007",
    category: "Supermarket",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Not configured",
    branches: 1,
    status: "Active",
  },
  {
    id: "8",
    name: "Bon Marché",
    reference: "DEMO-CUS-008",
    category: "Retail",
    contact: "Not provided",
    email: "Not provided",
    phone: "Not provided",
    location: "Not configured",
    branches: 1,
    status: "Active",
  },
];

export default function CustomersPage() {
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] =
    useState<Customer | null>(null);

  const [form, setForm] = useState({
    name: "",
    category: "Supermarket",
    contact: "",
    email: "",
    phone: "",
    location: "",
  });

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      const matchesSearch =
        customer.name.toLowerCase().includes(search.toLowerCase()) ||
        customer.reference.toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "All" || customer.status === statusFilter;

      const matchesCategory =
        categoryFilter === "All" || customer.category === categoryFilter;

      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [customers, search, statusFilter, categoryFilter]);

  const activeCount = customers.filter(
    (customer) => customer.status === "Active"
  ).length;

  const handleAddCustomer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const newCustomer: Customer = {
      id: Date.now().toString(),
      name: form.name.trim(),
      reference: `DEMO-CUS-${String(customers.length + 1).padStart(3, "0")}`,
      category: form.category,
      contact: form.contact.trim() || "Not provided",
      email: form.email.trim() || "Not provided",
      phone: form.phone.trim() || "Not provided",
      location: form.location.trim() || "Not configured",
      branches: 1,
      status: "Active",
    };

    setCustomers((previous) => [...previous, newCustomer]);
    setForm({
      name: "",
      category: "Supermarket",
      contact: "",
      email: "",
      phone: "",
      location: "",
    });
    setShowForm(false);
  };

  const toggleStatus = (id: string) => {
    setCustomers((previous) =>
      previous.map((customer) =>
        customer.id === id
          ? {
              ...customer,
              status:
                customer.status === "Active" ? "Inactive" : "Active",
            }
          : customer
      )
    );
    setSelectedCustomer(null);
  };

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">
              Workspace / Customers
            </p>
            <h1 className="mt-1 text-lg font-semibold">Customers</h1>
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
                  Sales management
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Customer directory
              </h2>
              <p className="mt-1 text-sm text-[#7D8981]">
                Manage customer accounts, contacts and delivery locations.
              </p>
            </div>

            <button
              onClick={() => setShowForm(true)}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#183D2D] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#24543D]"
            >
              <Plus size={17} />
              Add Customer
            </button>
          </div>

          <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Total customers",
                value: customers.length,
                icon: Users,
                note: "Customer accounts",
              },
              {
                label: "Active accounts",
                value: activeCount,
                icon: CheckCircle2,
                note: "Currently active",
              },
              {
                label: "Inactive accounts",
                value: customers.length - activeCount,
                icon: Clock3,
                note: "Not currently active",
              },
              {
                label: "Customer categories",
                value: new Set(customers.map((c) => c.category)).size,
                icon: Building2,
                note: "Configured categories",
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
                <h3 className="font-semibold">All customers</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  {filteredCustomers.length} customer accounts displayed
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-64">
                  <Search size={16} className="text-[#89948D]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search customers..."
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
                    <option value="Supermarket">Supermarket</option>
                    <option value="Retail">Retail</option>
                    <option value="Other">Other</option>
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
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Account reference</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Contact person</th>
                    <th className="px-5 py-3 font-medium">Location</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1ED]">
                  {filteredCustomers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="transition hover:bg-[#FAFBF9]"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EDF3ED] text-[#315C43]">
                            <Building2 size={17} />
                          </div>
                          <span className="text-sm font-medium">
                            {customer.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs text-[#7D8981]">
                        {customer.reference}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#59675E]">
                        {customer.category}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#89948D]">
                        {customer.contact}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#59675E]">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={14} className="text-[#89948D]" />
                          {customer.location}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            customer.status === "Active"
                              ? "bg-[#EAF5EC] text-[#347447]"
                              : "bg-[#F1F2F0] text-[#778078]"
                          }`}
                        >
                          {customer.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => setSelectedCustomer(customer)}
                          title="View customer"
                          className="rounded-lg p-2 text-[#89948D] hover:bg-[#EFF4EF] hover:text-[#315C43]"
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredCustomers.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-12 text-center text-sm text-[#89948D]"
                      >
                        No customers match your search or filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col justify-between gap-2 border-t border-[#E8ECE7] px-5 py-4 text-xs text-[#89948D] sm:flex-row">
              <span>
                Showing {filteredCustomers.length} of {customers.length} customers
              </span>
              <span>Illustrative records only · Not connected to SAP</span>
            </div>
          </section>
        </div>
      </main>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Add customer</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  Add an illustrative customer record to this demo.
                </p>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg p-2 text-[#89948D] hover:bg-[#F1F3F0]"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={handleAddCustomer} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Customer name *
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="Enter customer name"
                  className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none focus:border-[#315C43]"
                />
              </div>

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
                  <option>Supermarket</option>
                  <option>Retail</option>
                  <option>Wholesale</option>
                  <option>Other</option>
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Contact person
                  </label>
                  <input
                    value={form.contact}
                    onChange={(event) =>
                      setForm({ ...form, contact: event.target.value })
                    }
                    placeholder="Optional"
                    className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Phone
                  </label>
                  <input
                    value={form.phone}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                    placeholder="Optional"
                    className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  placeholder="Optional"
                  className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Delivery location
                </label>
                <input
                  value={form.location}
                  onChange={(event) =>
                    setForm({ ...form, location: event.target.value })
                  }
                  placeholder="City, branch or delivery address"
                  className="w-full rounded-lg border border-[#E1E7E0] px-3 py-2.5 text-sm outline-none"
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
                  Add customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedCustomer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-7 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Customer details</h3>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="rounded-lg p-2 text-[#89948D] hover:bg-[#F1F3F0]"
              >
                <X size={19} />
              </button>
            </div>

            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EDF3ED] text-[#315C43]">
                <Building2 size={22} />
              </div>
              <div>
                <h4 className="font-semibold">{selectedCustomer.name}</h4>
                <p className="text-xs text-[#89948D]">
                  {selectedCustomer.reference}
                </p>
              </div>
            </div>

            <div className="space-y-5">
              {[
                { label: "Category", value: selectedCustomer.category, icon: ShoppingBag },
                { label: "Contact person", value: selectedCustomer.contact, icon: UserRound },
                { label: "Email", value: selectedCustomer.email, icon: Mail },
                { label: "Phone", value: selectedCustomer.phone, icon: Phone },
                { label: "Location", value: selectedCustomer.location, icon: MapPin },
              ].map((detail) => {
                const Icon = detail.icon;
                return (
                  <div key={detail.label} className="flex gap-3">
                    <Icon size={17} className="mt-0.5 text-[#89948D]" />
                    <div>
                      <p className="text-xs text-[#89948D]">{detail.label}</p>
                      <p className="mt-1 text-sm font-medium">{detail.value}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4">
              <p className="text-sm font-semibold">Account status</p>
              <p className="mt-1 text-sm text-[#89948D]">
                This customer account is currently {selectedCustomer.status.toLowerCase()}.
              </p>
              <button
                onClick={() => toggleStatus(selectedCustomer.id)}
                className="mt-4 w-full rounded-lg border border-[#DCE5DC] bg-white px-4 py-2.5 text-sm font-medium text-[#315C43] hover:bg-[#EFF4EF]"
              >
                {selectedCustomer.status === "Active"
                  ? "Deactivate customer"
                  : "Activate customer"}
              </button>
            </div>

            <p className="mt-6 text-xs leading-5 text-[#9AA39D]">
              Demo customer profile. Customer order history and SAP account
              integration will be added in a later stage.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
