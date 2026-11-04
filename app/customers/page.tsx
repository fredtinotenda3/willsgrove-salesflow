"use client";

import { useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  Users,
  Building2,
  MapPin,
  ShoppingBag,
  X,
  CheckCircle2,
  Clock3,
  Mail,
  Phone,
  ArrowUpRight,
  Filter,
  AlertTriangle,
} from "lucide-react";
import Sidebar from "../components/sidebar";

const PAGE_SIZE = 50;

type Status = "ACTIVE" | "INACTIVE";
type StatusFilter = "All" | "Active" | "Inactive";
type FieldErrors = Record<string, string>;

type CustomerRow = {
  id: string;
  name: string;
  sapCustomerCode: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  status: Status;
  createdAt: string;
  primaryLocation: { label: string; city: string | null } | null;
  activeLocationCount: number;
  orderCount: number;
};

type ListResponse = {
  success: true;
  customers: CustomerRow[];
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
    withoutLocations: number;
  };
};

type LocationRow = {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  isDefault: boolean;
  isActive: boolean;
};

type CustomerDetail = {
  id: string;
  name: string;
  sapCustomerCode: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  status: Status;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  locations: LocationRow[];
  orderCount: number;
};

type ApiBody = {
  success?: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  customer?: CustomerDetail;
};

type ApiResult = { ok: boolean; status: number; body: ApiBody | null };

type CustomerValues = {
  name: string;
  sapCustomerCode: string;
  category: string;
  email: string;
  phone: string;
  notes: string;
};

type LocationValues = {
  label: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
};

type LocationFormState =
  | { mode: "add" }
  | { mode: "edit"; id: string }
  | null;

const emptyCustomer: CustomerValues = {
  name: "",
  sapCustomerCode: "",
  category: "",
  email: "",
  phone: "",
  notes: "",
};

const emptyLocation: LocationValues = {
  label: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "",
};

function formatNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US");
}

function statusLabel(status: Status): string {
  return status === "ACTIVE" ? "Active" : "Inactive";
}

async function apiRequest(
  url: string,
  method: string,
  payload?: unknown
): Promise<ApiResult> {
  try {
    const response = await fetch(url, {
      method,
      headers:
        payload !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });

    let body: ApiBody | null = null;

    try {
      body = (await response.json()) as ApiBody;
    } catch {
      body = null;
    }

    return { ok: response.ok && body?.success === true, status: response.status, body };
  } catch {
    return {
      ok: false,
      status: 0,
      body: {
        success: false,
        message: "Could not reach the server. Please try again.",
      },
    };
  }
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
  maxLength?: number;
  listId?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {props.label}
        {props.required ? " *" : ""}
      </label>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        list={props.listId}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[#315C43] ${
          props.error ? "border-[#E7A4A4]" : "border-[#E1E7E0]"
        }`}
      />
      {props.error && (
        <p className="mt-1 text-xs text-[#9B3B3B]">{props.error}</p>
      )}
    </div>
  );
}

function CustomerFields(props: {
  values: CustomerValues;
  onChange: (next: CustomerValues) => void;
  errors: FieldErrors;
  categoryListId: string;
}) {
  const { values, onChange, errors } = props;

  return (
    <div className="space-y-4">
      <TextField
        label="Customer name"
        required
        value={values.name}
        onChange={(value) => onChange({ ...values, name: value })}
        error={errors.name}
        placeholder="Enter customer name"
        maxLength={150}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="SAP customer code"
          value={values.sapCustomerCode}
          onChange={(value) => onChange({ ...values, sapCustomerCode: value })}
          error={errors.sapCustomerCode}
          placeholder="Only if known"
          maxLength={50}
        />
        <TextField
          label="Category"
          value={values.category}
          onChange={(value) => onChange({ ...values, category: value })}
          error={errors.category}
          placeholder="Optional"
          maxLength={60}
          listId={props.categoryListId}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Phone"
          value={values.phone}
          onChange={(value) => onChange({ ...values, phone: value })}
          error={errors.phone}
          placeholder="Optional"
          maxLength={30}
        />
        <TextField
          label="Email"
          value={values.email}
          onChange={(value) => onChange({ ...values, email: value })}
          error={errors.email}
          placeholder="Optional"
          maxLength={254}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Notes</label>
        <textarea
          value={values.notes}
          onChange={(event) =>
            onChange({ ...values, notes: event.target.value })
          }
          rows={3}
          maxLength={1000}
          placeholder="Optional"
          className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[#315C43] ${
            errors.notes ? "border-[#E7A4A4]" : "border-[#E1E7E0]"
          }`}
        />
        {errors.notes && (
          <p className="mt-1 text-xs text-[#9B3B3B]">{errors.notes}</p>
        )}
      </div>
    </div>
  );
}

function LocationFields(props: {
  values: LocationValues;
  onChange: (next: LocationValues) => void;
  errors: FieldErrors;
  prefix: string;
}) {
  const { values, onChange, errors, prefix } = props;
  const error = (key: string) => errors[`${prefix}${key}`];

  return (
    <div className="space-y-3">
      <TextField
        label="Location label"
        required
        value={values.label}
        onChange={(value) => onChange({ ...values, label: value })}
        error={error("label")}
        placeholder="Branch or delivery point name"
        maxLength={80}
      />
      <TextField
        label="Address line 1"
        required
        value={values.addressLine1}
        onChange={(value) => onChange({ ...values, addressLine1: value })}
        error={error("addressLine1")}
        maxLength={200}
      />
      <TextField
        label="Address line 2"
        value={values.addressLine2}
        onChange={(value) => onChange({ ...values, addressLine2: value })}
        error={error("addressLine2")}
        maxLength={200}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="City"
          value={values.city}
          onChange={(value) => onChange({ ...values, city: value })}
          error={error("city")}
          maxLength={80}
        />
        <TextField
          label="Province"
          value={values.province}
          onChange={(value) => onChange({ ...values, province: value })}
          error={error("province")}
          maxLength={80}
        />
      </div>
    </div>
  );
}

function hasAnyValue(values: LocationValues): boolean {
  return Object.values(values).some((value) => value.trim() !== "");
}

export default function CustomersPage() {
  // List state
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [page, setPage] = useState(1);

  // Add customer modal
  const [showAdd, setShowAdd] = useState(false);
  const [addValues, setAddValues] = useState<CustomerValues>(emptyCustomer);
  const [addLocation, setAddLocation] = useState<LocationValues>(emptyLocation);
  const [addErrors, setAddErrors] = useState<FieldErrors>({});
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  // Detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latestOpenId = useRef<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<CustomerValues>(emptyCustomer);
  const [editErrors, setEditErrors] = useState<FieldErrors>({});

  const [locationForm, setLocationForm] = useState<LocationFormState>(null);
  const [locationValues, setLocationValues] =
    useState<LocationValues>(emptyLocation);
  const [locationErrors, setLocationErrors] = useState<FieldErrors>({});

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
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });

        if (debouncedSearch) {
          params.set("search", debouncedSearch);
        }

        if (categoryFilter !== "All") {
          params.set("category", categoryFilter);
        }

        if (statusFilter !== "All") {
          params.set("status", statusFilter.toUpperCase());
        }

        const response = await fetch(`/api/customers?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.success) {
          throw new Error(body?.message ?? "Unable to load customers.");
        }

        setData(body as ListResponse);
      } catch (caught) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          caught instanceof Error ? caught.message : "Unable to load customers."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [page, debouncedSearch, categoryFilter, statusFilter, reloadKey]);

  const customers = data?.customers ?? [];
  const pagination = data?.pagination;
  const stats = data?.stats;
  const categories = data?.categories ?? [];

  function resetPanelForms() {
    setEditing(false);
    setEditErrors({});
    setLocationForm(null);
    setLocationValues(emptyLocation);
    setLocationErrors({});
    setPanelError(null);
  }

  async function openCustomer(id: string) {
    latestOpenId.current = id;
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    resetPanelForms();
    setDetailLoading(true);

    const result = await apiRequest(`/api/customers/${id}`, "GET");

    if (latestOpenId.current !== id) {
      return;
    }

    if (result.ok && result.body?.customer) {
      setDetail(result.body.customer);
    } else {
      setDetailError(result.body?.message ?? "Unable to load the customer.");
    }

    setDetailLoading(false);
  }

  function closePanel() {
    latestOpenId.current = null;
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    resetPanelForms();
  }

  async function runMutation(
    url: string,
    method: string,
    payload: unknown
  ): Promise<ApiResult> {
    setSaving(true);
    setPanelError(null);

    const result = await apiRequest(url, method, payload);

    setSaving(false);

    if (result.ok && result.body?.customer) {
      setDetail(result.body.customer);
      setReloadKey((key) => key + 1);
    }

    return result;
  }

  function startEdit() {
    if (!detail) {
      return;
    }

    setEditValues({
      name: detail.name,
      sapCustomerCode: detail.sapCustomerCode ?? "",
      category: detail.category ?? "",
      email: detail.email ?? "",
      phone: detail.phone ?? "",
      notes: detail.notes ?? "",
    });
    setEditErrors({});
    setPanelError(null);
    setEditing(true);
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const result = await runMutation(
      `/api/customers/${detail.id}`,
      "PATCH",
      editValues
    );

    if (result.ok) {
      setEditing(false);
      setEditErrors({});
      return;
    }

    setEditErrors(result.body?.fieldErrors ?? {});

    if (!result.body?.fieldErrors) {
      setPanelError(result.body?.message ?? "Unable to save changes.");
    }
  }

  async function toggleStatus() {
    if (!detail) {
      return;
    }

    const next: Status = detail.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    if (
      next === "INACTIVE" &&
      !window.confirm(
        `Deactivate ${detail.name}? Existing records are kept, and you can activate the customer again later.`
      )
    ) {
      return;
    }

    const result = await runMutation(`/api/customers/${detail.id}`, "PATCH", {
      status: next,
    });

    if (!result.ok) {
      setPanelError(result.body?.message ?? "Unable to change the status.");
    }
  }

  function startAddLocation() {
    setLocationForm({ mode: "add" });
    setLocationValues(emptyLocation);
    setLocationErrors({});
    setPanelError(null);
  }

  function startEditLocation(location: LocationRow) {
    setLocationForm({ mode: "edit", id: location.id });
    setLocationValues({
      label: location.label,
      addressLine1: location.addressLine1,
      addressLine2: location.addressLine2 ?? "",
      city: location.city ?? "",
      province: location.province ?? "",
    });
    setLocationErrors({});
    setPanelError(null);
  }

  async function saveLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!detail || !locationForm) {
      return;
    }

    const url =
      locationForm.mode === "add"
        ? `/api/customers/${detail.id}/locations`
        : `/api/customers/${detail.id}/locations/${locationForm.id}`;

    const result = await runMutation(
      url,
      locationForm.mode === "add" ? "POST" : "PATCH",
      locationValues
    );

    if (result.ok) {
      setLocationForm(null);
      setLocationValues(emptyLocation);
      setLocationErrors({});
      return;
    }

    setLocationErrors(result.body?.fieldErrors ?? {});

    if (!result.body?.fieldErrors) {
      setPanelError(result.body?.message ?? "Unable to save the location.");
    }
  }

  async function changeLocation(
    locationId: string,
    changes: { isDefault?: true; isActive?: boolean }
  ) {
    if (!detail) {
      return;
    }

    const result = await runMutation(
      `/api/customers/${detail.id}/locations/${locationId}`,
      "PATCH",
      changes
    );

    if (!result.ok) {
      setPanelError(result.body?.message ?? "Unable to update the location.");
    }
  }

  function openAddModal() {
    setAddValues(emptyCustomer);
    setAddLocation(emptyLocation);
    setAddErrors({});
    setAddMessage(null);
    setShowAdd(true);
  }

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddSaving(true);
    setAddErrors({});
    setAddMessage(null);

    const payload: Record<string, unknown> = { ...addValues };

    if (hasAnyValue(addLocation)) {
      payload.location = addLocation;
    }

    const result = await apiRequest("/api/customers", "POST", payload);

    setAddSaving(false);

    if (result.ok && result.body?.customer) {
      const createdId = result.body.customer.id;

      setShowAdd(false);
      setReloadKey((key) => key + 1);
      openCustomer(createdId);
      return;
    }

    const fieldErrors: FieldErrors = {};

    for (const [key, message] of Object.entries(
      result.body?.fieldErrors ?? {}
    )) {
      fieldErrors[key] = message;
    }

    setAddErrors(fieldErrors);

    if (Object.keys(fieldErrors).length === 0) {
      setAddMessage(result.body?.message ?? "Unable to add the customer.");
    }
  }

  const rangeStart =
    pagination && pagination.totalItems > 0
      ? (pagination.page - 1) * pagination.pageSize + 1
      : 0;
  const rangeEnd = pagination
    ? Math.min(pagination.page * pagination.pageSize, pagination.totalItems)
    : 0;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <datalist id="customer-categories">
        {categories.map((category) => (
          <option key={category.name} value={category.name} />
        ))}
      </datalist>

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / Customers</p>
            <h1 className="mt-1 text-lg font-semibold">Customers</h1>
          </div>

          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF0E9] text-sm font-semibold text-[#315C43]">
            SA
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-5 md:p-9">
          <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-[#EAF5EC] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#347447]">
                  Live data
                </span>
                <span className="text-xs text-[#89948D]">
                  Sales management
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Customer directory
              </h2>
              <p className="mt-1 text-sm text-[#7D8981]">
                Manage customer accounts and delivery locations.
              </p>
            </div>

            <button
              onClick={openAddModal}
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
                value: formatNumber(stats?.total),
                icon: Users,
                note: "Customer accounts",
              },
              {
                label: "Active accounts",
                value: formatNumber(stats?.active),
                icon: CheckCircle2,
                note: "Currently active",
              },
              {
                label: "Inactive accounts",
                value: formatNumber(stats?.inactive),
                icon: Clock3,
                note: "Not currently active",
              },
              {
                label: "No delivery location",
                value: formatNumber(stats?.withoutLocations),
                icon: MapPin,
                note: "Customers without an active location",
              },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.label}
                  className="rounded-xl border border-[#E8ECE7] bg-white p-5"
                >
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
                <h3 className="font-semibold">All customers</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  {pagination
                    ? `${formatNumber(pagination.totalItems)} matching customer accounts`
                    : "Loading customers..."}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2 sm:w-72">
                  <Search size={16} className="text-[#89948D]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, SAP code, email or phone..."
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
                    <option value="All">All categories</option>
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
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-[#FAFBF9] text-xs text-[#89948D]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">SAP code</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Contact</th>
                    <th className="px-5 py-3 font-medium">Delivery location</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1ED]">
                  {customers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="transition hover:bg-[#FAFBF9]"
                    >
                      <td className="px-5 py-4">
                        <button
                          onClick={() => openCustomer(customer.id)}
                          className="flex items-center gap-3 text-left"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EDF3ED] text-[#315C43]">
                            <Building2 size={17} />
                          </div>
                          <span className="text-sm font-medium">
                            {customer.name}
                          </span>
                        </button>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-[#7D8981]">
                        {customer.sapCustomerCode ?? "-"}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#59675E]">
                        {customer.category ?? "-"}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#59675E]">
                        {customer.phone ?? customer.email ?? (
                          <span className="text-[#A3ACA6]">Not provided</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#59675E]">
                        {customer.primaryLocation ? (
                          <div className="flex items-center gap-1.5">
                            <MapPin size={14} className="text-[#89948D]" />
                            <span>
                              {customer.primaryLocation.label}
                              {customer.primaryLocation.city
                                ? `, ${customer.primaryLocation.city}`
                                : ""}
                            </span>
                            {customer.activeLocationCount > 1 && (
                              <span className="text-xs text-[#89948D]">
                                +{customer.activeLocationCount - 1} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#A3ACA6]">Not configured</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            customer.status === "ACTIVE"
                              ? "bg-[#EAF5EC] text-[#347447]"
                              : "bg-[#F1F2F0] text-[#778078]"
                          }`}
                        >
                          {statusLabel(customer.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openCustomer(customer.id)}
                          title="View customer"
                          className="rounded-lg p-2 text-[#89948D] hover:bg-[#EFF4EF] hover:text-[#315C43]"
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!loading && !error && customers.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-12 text-center text-sm text-[#89948D]"
                      >
                        {data?.stats.total === 0
                          ? "No customers yet. Use Add Customer to create the first one."
                          : "No customers match your search or filters."}
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
                  disabled={
                    !pagination ||
                    pagination.page >= pagination.totalPages ||
                    loading
                  }
                  className="rounded-lg border border-[#E5EAE4] px-3 py-1.5 text-[#315C43] hover:bg-[#F7F8F6] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>

            <p className="border-t border-[#E8ECE7] px-5 py-3 text-xs text-[#9AA39D]">
              Customer records are stored in SalesFlow. Not connected to SAP.
            </p>
          </section>
        </div>
      </main>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Add customer</h3>
                <p className="mt-1 text-xs text-[#89948D]">
                  Only the name is required. Add a delivery location now or
                  later.
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

            <form onSubmit={submitAdd} className="space-y-5">
              {addMessage && (
                <div className="flex items-start gap-2 rounded-lg border border-[#F1D9D9] bg-[#FFF6F6] px-3 py-2 text-sm text-[#9B3B3B]">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <p>{addMessage}</p>
                </div>
              )}

              <CustomerFields
                values={addValues}
                onChange={setAddValues}
                errors={addErrors}
                categoryListId="customer-categories"
              />

              <div className="rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4">
                <p className="mb-3 text-sm font-semibold">
                  First delivery location (optional)
                </p>
                <LocationFields
                  values={addLocation}
                  onChange={setAddLocation}
                  errors={addErrors}
                  prefix="location."
                />
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
                  {addSaving ? "Saving..." : "Add customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedId && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Customer details</h3>
              <button
                onClick={closePanel}
                className="rounded-lg p-2 text-[#89948D] hover:bg-[#F1F3F0]"
              >
                <X size={19} />
              </button>
            </div>

            {detailLoading && (
              <p className="text-sm text-[#89948D]">Loading customer...</p>
            )}

            {detailError && (
              <div className="rounded-lg border border-[#F1D9D9] bg-[#FFF6F6] px-4 py-3 text-sm text-[#9B3B3B]">
                {detailError}
                <button
                  onClick={() => openCustomer(selectedId)}
                  className="mt-3 block rounded-lg border border-[#E7C4C4] bg-white px-3 py-1.5 font-medium hover:bg-[#FFF0F0]"
                >
                  Try again
                </button>
              </div>
            )}

            {detail && (
              <>
                {panelError && (
                  <div className="mb-5 flex items-start gap-2 rounded-lg border border-[#F1D9D9] bg-[#FFF6F6] px-3 py-2 text-sm text-[#9B3B3B]">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <p>{panelError}</p>
                  </div>
                )}

                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EDF3ED] text-[#315C43]">
                    <Building2 size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate font-semibold">{detail.name}</h4>
                    <p className="font-mono text-xs text-[#89948D]">
                      {detail.sapCustomerCode ?? "No SAP customer code"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      detail.status === "ACTIVE"
                        ? "bg-[#EAF5EC] text-[#347447]"
                        : "bg-[#F1F2F0] text-[#778078]"
                    }`}
                  >
                    {statusLabel(detail.status)}
                  </span>
                </div>

                {editing ? (
                  <form onSubmit={saveEdit} className="space-y-4">
                    <CustomerFields
                      values={editValues}
                      onChange={setEditValues}
                      errors={editErrors}
                      categoryListId="customer-categories"
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setEditErrors({});
                        }}
                        disabled={saving}
                        className="rounded-lg border border-[#E1E7E0] px-4 py-2 text-sm font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-lg bg-[#183D2D] px-4 py-2 text-sm font-medium text-white hover:bg-[#24543D] disabled:opacity-60"
                      >
                        {saving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="space-y-5">
                      {[
                        {
                          label: "Category",
                          value: detail.category,
                          icon: ShoppingBag,
                        },
                        { label: "Email", value: detail.email, icon: Mail },
                        { label: "Phone", value: detail.phone, icon: Phone },
                      ].map((item) => {
                        const Icon = item.icon;

                        return (
                          <div key={item.label} className="flex gap-3">
                            <Icon size={17} className="mt-0.5 text-[#89948D]" />
                            <div>
                              <p className="text-xs text-[#89948D]">
                                {item.label}
                              </p>
                              <p className="mt-1 text-sm font-medium">
                                {item.value ?? (
                                  <span className="font-normal text-[#A3ACA6]">
                                    Not provided
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      })}

                      <div>
                        <p className="text-xs text-[#89948D]">Notes</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          {detail.notes ?? (
                            <span className="text-[#A3ACA6]">No notes</span>
                          )}
                        </p>
                      </div>

                      <p className="text-xs text-[#89948D]">
                        Orders on record: {formatNumber(detail.orderCount)}
                      </p>
                    </div>

                    <button
                      onClick={startEdit}
                      className="mt-5 rounded-lg border border-[#DCE5DC] bg-white px-4 py-2 text-sm font-medium text-[#315C43] hover:bg-[#EFF4EF]"
                    >
                      Edit details
                    </button>
                  </>
                )}

                <div className="mt-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Delivery locations</h4>
                    {!locationForm && (
                      <button
                        onClick={startAddLocation}
                        className="flex items-center gap-1.5 rounded-lg border border-[#DCE5DC] bg-white px-3 py-1.5 text-xs font-medium text-[#315C43] hover:bg-[#EFF4EF]"
                      >
                        <Plus size={14} />
                        Add location
                      </button>
                    )}
                  </div>

                  {locationForm?.mode === "add" && (
                    <form
                      onSubmit={saveLocation}
                      className="mb-4 rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4"
                    >
                      <p className="mb-3 text-sm font-semibold">
                        New location
                      </p>
                      <LocationFields
                        values={locationValues}
                        onChange={setLocationValues}
                        errors={locationErrors}
                        prefix=""
                      />
                      <div className="mt-4 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setLocationForm(null)}
                          disabled={saving}
                          className="rounded-lg border border-[#E1E7E0] bg-white px-4 py-2 text-sm font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={saving}
                          className="rounded-lg bg-[#183D2D] px-4 py-2 text-sm font-medium text-white hover:bg-[#24543D] disabled:opacity-60"
                        >
                          {saving ? "Saving..." : "Add location"}
                        </button>
                      </div>
                    </form>
                  )}

                  {detail.locations.length === 0 && !locationForm && (
                    <p className="rounded-lg border border-dashed border-[#DCE5DC] px-4 py-6 text-center text-sm text-[#89948D]">
                      No delivery locations yet.
                    </p>
                  )}

                  <div className="space-y-3">
                    {detail.locations.map((location) => {
                      const isEditing =
                        locationForm?.mode === "edit" &&
                        locationForm.id === location.id;

                      if (isEditing) {
                        return (
                          <form
                            key={location.id}
                            onSubmit={saveLocation}
                            className="rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4"
                          >
                            <p className="mb-3 text-sm font-semibold">
                              Edit location
                            </p>
                            <LocationFields
                              values={locationValues}
                              onChange={setLocationValues}
                              errors={locationErrors}
                              prefix=""
                            />
                            <div className="mt-4 flex justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => setLocationForm(null)}
                                disabled={saving}
                                className="rounded-lg border border-[#E1E7E0] bg-white px-4 py-2 text-sm font-medium"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={saving}
                                className="rounded-lg bg-[#183D2D] px-4 py-2 text-sm font-medium text-white hover:bg-[#24543D] disabled:opacity-60"
                              >
                                {saving ? "Saving..." : "Save location"}
                              </button>
                            </div>
                          </form>
                        );
                      }

                      return (
                        <div
                          key={location.id}
                          className={`rounded-xl border p-4 ${
                            location.isActive
                              ? "border-[#E8ECE7] bg-white"
                              : "border-[#EEF1ED] bg-[#FAFBF9] opacity-75"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">
                                {location.label}
                              </p>
                              <p className="mt-1 text-sm text-[#59675E]">
                                {[
                                  location.addressLine1,
                                  location.addressLine2,
                                  location.city,
                                  location.province,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </p>
                            </div>

                            <div className="flex shrink-0 gap-1.5">
                              {location.isDefault && (
                                <span className="rounded-full bg-[#EAF5EC] px-2 py-0.5 text-[10px] font-semibold text-[#347447]">
                                  Default
                                </span>
                              )}
                              {!location.isActive && (
                                <span className="rounded-full bg-[#F1F2F0] px-2 py-0.5 text-[10px] font-semibold text-[#778078]">
                                  Inactive
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => startEditLocation(location)}
                              disabled={saving || locationForm !== null}
                              className="rounded-lg border border-[#E1E7E0] px-3 py-1 text-xs font-medium hover:bg-[#F7F8F6] disabled:opacity-50"
                            >
                              Edit
                            </button>

                            {location.isActive && !location.isDefault && (
                              <button
                                onClick={() =>
                                  changeLocation(location.id, {
                                    isDefault: true,
                                  })
                                }
                                disabled={saving}
                                className="rounded-lg border border-[#E1E7E0] px-3 py-1 text-xs font-medium hover:bg-[#F7F8F6] disabled:opacity-50"
                              >
                                Make default
                              </button>
                            )}

                            {location.isActive ? (
                              <button
                                onClick={() =>
                                  changeLocation(location.id, {
                                    isActive: false,
                                  })
                                }
                                disabled={saving}
                                className="rounded-lg border border-[#E1E7E0] px-3 py-1 text-xs font-medium text-[#9B3B3B] hover:bg-[#FFF6F6] disabled:opacity-50"
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  changeLocation(location.id, {
                                    isActive: true,
                                  })
                                }
                                disabled={saving}
                                className="rounded-lg border border-[#E1E7E0] px-3 py-1 text-xs font-medium hover:bg-[#F7F8F6] disabled:opacity-50"
                              >
                                Activate
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-8 rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] p-4">
                  <p className="text-sm font-semibold">Account status</p>
                  <p className="mt-1 text-sm text-[#89948D]">
                    This customer account is currently{" "}
                    {statusLabel(detail.status).toLowerCase()}.
                  </p>
                  <button
                    onClick={toggleStatus}
                    disabled={saving}
                    className="mt-4 w-full rounded-lg border border-[#DCE5DC] bg-white px-4 py-2.5 text-sm font-medium text-[#315C43] hover:bg-[#EFF4EF] disabled:opacity-60"
                  >
                    {detail.status === "ACTIVE"
                      ? "Deactivate customer"
                      : "Activate customer"}
                  </button>
                </div>

                <p className="mt-6 text-xs leading-5 text-[#9AA39D]">
                  Order history and SAP account integration will be added in a
                  later stage.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}