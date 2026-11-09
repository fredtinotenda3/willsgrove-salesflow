"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Sidebar from "../../components/sidebar";
import { ORDER_SOURCE_LABELS } from "@/lib/order-display";

import {
  Search,
  Bell,
  ArrowLeft,
  Upload,
  MessageSquare,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";

type CustomerSummary = {
  id: string;
  name: string;
  sapCustomerCode: string | null;
  primaryLocation: { label: string; city: string } | null;
};

type CustomerLocation = {
  id: string;
  label: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string | null;
  isDefault: boolean;
  isActive: boolean;
};

type ProductSuggestion = {
  id: string;
  itemName: string;
  sapItemCode: string | null;
};

type LineDraft = {
  key: string;
  originalProductDescription: string;
  productQuery: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  requestedQuantity: string;
  requestedUnitCode: string;
  customerUnitPrice: string;
  salesNotes: string;
  suggestions: ProductSuggestion[];
  showSuggestions: boolean;
  error: string | null;
};

// `key` is an explicit parameter (rather than always generating one
// internally) so the one line created as useState's initial value can use
// a fixed, deterministic string instead of crypto.randomUUID(). Next 16's
// Cache Components prerendering treats crypto.randomUUID() -- like
// Math.random() or new Date() -- as "unstable" synchronous IO and fails
// the build if it runs during the initial render (confirmed: this is
// exactly what broke the real build with "Next.js encountered the
// unstable value `crypto.randomUUID()` in a Client Component" on
// /orders/new). Calling it inside addLine() below is fine -- that only
// ever runs from a client click handler, never during prerender. These
// keys are only ever used as a local React list key within one open form,
// never sent anywhere, so a fixed string for the one initial row is safe.
function newLine(key?: string): LineDraft {
  return {
    key: key ?? crypto.randomUUID(),
    originalProductDescription: "",
    productQuery: "",
    productId: null,
    sapItemCodeSnapshot: null,
    requestedQuantity: "",
    requestedUnitCode: "",
    customerUnitPrice: "",
    salesNotes: "",
    suggestions: [],
    showSuggestions: false,
    error: null,
  };
}

// A line counts as "started" only once the staff member has typed or
// picked something into it. The form always shows one blank row by
// default so manual entry is one click away, but that blank row must not
// force a line onto an order that was actually submitted via a pasted
// message and/or an uploaded file (modes (b)/(c) -- see the paste/upload
// section below) with no manual lines at all. Only started lines are
// validated for completeness and sent to the server.
function isLineBlank(line: LineDraft): boolean {
  return (
    line.originalProductDescription.trim() === "" &&
    line.productQuery.trim() === "" &&
    line.productId === null &&
    line.requestedQuantity.trim() === "" &&
    line.requestedUnitCode.trim() === "" &&
    line.customerUnitPrice.trim() === "" &&
    line.salesNotes.trim() === ""
  );
}

function getStartedLines(lines: LineDraft[]): LineDraft[] {
  return lines.filter((line) => !isLineBlank(line));
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

type CreateOrderResponse = {
  success: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  order?: { id: string; reference: string };
  idempotentReplay?: boolean;
};

type DocumentUploadState = {
  file: File;
  status: "idle" | "uploading" | "success" | "error";
  message: string | null;
};

export default function NewOrderPage() {
  // Same prerender constraint as newLine() above: crypto.randomUUID() must
  // not run as part of the initial render. Initialize to an empty string
  // (a stable, prerenderable value) and fill it in a mount effect instead
  // -- effects only ever run client-side, after the real request, never
  // during the build's prerender pass.
  const idempotencyKey = useRef("");
  useEffect(() => {
    if (!idempotencyKey.current) {
      idempotencyKey.current = crypto.randomUUID();
    }
  }, []);

  // Pasted message/PO text and attached file(s) are independent, optional,
  // and combinable with each other and with manual order lines below --
  // per the brief, an order can be created from any one of these, or any
  // combination. Neither auto-extracts into order lines (that's
  // Milestone 2); an order submitted with no manual lines waits for a
  // human to add them after reading what's pasted/attached (see the
  // empty-state copy below and on the order detail page).
  const [pastedText, setPastedText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const [source, setSource] = useState<"EMAIL" | "WHATSAPP" | "MANUAL">("EMAIL");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSummary[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);

  const [locations, setLocations] = useState<CustomerLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [customerLocationId, setCustomerLocationId] = useState<string>("");

  const [customerPoReference, setCustomerPoReference] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const [lines, setLines] = useState<LineDraft[]>([newLine("initial-line")]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [createdOrder, setCreatedOrder] = useState<{ id: string; reference: string } | null>(null);
  const [documentUploads, setDocumentUploads] = useState<DocumentUploadState[]>([]);

  // Debounced customer search. Nothing is reset synchronously when the
  // query is empty -- the results dropdown's own JSX guard
  // (`customerQuery.trim() !== ""`) already hides stale results, so no
  // effect-body setState is needed for that case (an effect whose only job
  // is mirroring a value into state, with no real subscription, is exactly
  // what react-hooks/set-state-in-effect flags -- see CHANGES.md).
  useEffect(() => {
    const query = customerQuery.trim();
    if (query === "") return;

    const timer = setTimeout(() => {
      setCustomerSearchLoading(true);
      fetch(`/api/customers?search=${encodeURIComponent(query)}&pageSize=8`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setCustomerResults(data.customers ?? []);
        })
        .catch(() => setCustomerResults([]))
        .finally(() => setCustomerSearchLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [customerQuery]);

  // Load the selected customer's delivery locations. Same rationale as
  // above for the early-exit branch -- locations/customerLocationId are
  // only ever read in JSX while selectedCustomer is set, so clearing them
  // synchronously when it becomes null isn't needed.
  useEffect(() => {
    if (!selectedCustomer) return;

    let ignore = false;
    Promise.resolve()
      .then(() => {
        setLocationsLoading(true);
        return fetch(`/api/customers/${selectedCustomer.id}`, { cache: "no-store" });
      })
      .then((res) => res.json())
      .then((data) => {
        if (ignore) return;
        if (data.success) {
          const activeLocations: CustomerLocation[] = (data.customer?.locations ?? []).filter(
            (loc: CustomerLocation) => loc.isActive
          );
          setLocations(activeLocations);
          const defaultLocation = activeLocations.find((loc) => loc.isDefault);
          setCustomerLocationId(defaultLocation?.id ?? "");
        }
      })
      .catch(() => {
        if (!ignore) setLocations([]);
      })
      .finally(() => {
        if (!ignore) setLocationsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedCustomer]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((line) => line.key !== key) : prev));
  }

  // Debounced per-line catalogue search -- matches by SAP code, item name
  // or barcode (the same /api/products search the Products page itself
  // uses; see lib/product-queries.ts's listProducts for the OR'd match).
  const productSearchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function handleProductQueryChange(key: string, value: string) {
    updateLine(key, { productQuery: value, showSuggestions: true });

    if (productSearchTimers.current[key]) clearTimeout(productSearchTimers.current[key]);
    if (value.trim() === "") {
      updateLine(key, { suggestions: [] });
      return;
    }
    productSearchTimers.current[key] = setTimeout(() => {
      fetch(`/api/products?search=${encodeURIComponent(value.trim())}&pageSize=6`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            updateLine(key, {
              suggestions: (data.products ?? []).map((p: ProductSuggestion) => ({
                id: p.id,
                itemName: p.itemName,
                sapItemCode: p.sapItemCode,
              })),
            });
          }
        })
        .catch(() => {});
    }, 300);
  }

  function selectProduct(key: string, product: ProductSuggestion) {
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              productId: product.id,
              sapItemCodeSnapshot: product.sapItemCode,
              productQuery: product.itemName,
              originalProductDescription: line.originalProductDescription.trim()
                ? line.originalProductDescription
                : product.itemName,
              suggestions: [],
              showSuggestions: false,
            }
          : line
      )
    );
  }

  function handleFilesPicked(picked: File[]) {
    if (picked.length === 0) return;
    setSelectedFiles((prev) => [...prev, ...picked]);
  }

  function removeSelectedFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function validateClientSide(): { error: string | null; startedLines: LineDraft[] } {
    const startedLines = getStartedLines(lines);

    if (!selectedCustomer) {
      return { error: "Select a customer before submitting.", startedLines };
    }

    for (const line of startedLines) {
      if (!line.originalProductDescription.trim()) {
        return { error: "Every order line you've started needs a product description.", startedLines };
      }
      if (!line.requestedQuantity.trim()) {
        return { error: "Every order line you've started needs a quantity.", startedLines };
      }
      if (!/^\d{1,14}(\.\d{1,4})?$/.test(line.requestedQuantity.trim()) || Number(line.requestedQuantity) <= 0) {
        return {
          error: "Quantity must be a positive number with up to 4 decimal places.",
          startedLines,
        };
      }
      if (!line.requestedUnitCode.trim()) {
        return { error: "Every order line you've started needs a unit (e.g. KG, EA, BOX).", startedLines };
      }
    }

    const hasPastedText = pastedText.trim() !== "";
    const hasFiles = selectedFiles.length > 0;
    if (startedLines.length === 0 && !hasPastedText && !hasFiles) {
      return {
        error: "Add at least one order line, paste the customer's message, or attach a file before submitting.",
        startedLines,
      };
    }

    return { error: null, startedLines };
  }

  async function uploadOneDocument(orderId: string, index: number, file: File) {
    setDocumentUploads((prev) =>
      prev.map((upload, i) => (i === index ? { ...upload, status: "uploading", message: null } : upload))
    );
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", "CUSTOMER_PO");
      const response = await fetch(`/api/orders/${orderId}/documents`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setDocumentUploads((prev) =>
          prev.map((upload, i) =>
            i === index
              ? { ...upload, status: "error", message: data.message ?? "The order was created, but this file failed to upload." }
              : upload
          )
        );
        return;
      }
      setDocumentUploads((prev) =>
        prev.map((upload, i) => (i === index ? { ...upload, status: "success", message: null } : upload))
      );
    } catch {
      setDocumentUploads((prev) =>
        prev.map((upload, i) =>
          i === index
            ? {
                ...upload,
                status: "error",
                message: "The order was created, but this file failed to upload. Check your connection and retry.",
              }
            : upload
        )
      );
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const { error: clientError, startedLines } = validateClientSide();
    if (clientError) {
      setFormError(clientError);
      return;
    }
    if (!selectedCustomer) return;

    setSubmitting(true);

    const body: Record<string, unknown> = {
      customerId: selectedCustomer.id,
      source,
      idempotencyKey: idempotencyKey.current,
      lines: startedLines.map((line) => ({
        originalProductDescription: line.originalProductDescription.trim(),
        productId: line.productId ?? undefined,
        sapItemCodeSnapshot: line.sapItemCodeSnapshot ?? undefined,
        requestedQuantity: line.requestedQuantity.trim(),
        requestedUnitCode: line.requestedUnitCode.trim().toUpperCase(),
        customerUnitPrice: blankToUndefined(line.customerUnitPrice),
        salesNotes: blankToUndefined(line.salesNotes),
      })),
    };

    if (customerLocationId) body.customerLocationId = customerLocationId;
    const poRef = blankToUndefined(customerPoReference);
    if (poRef) body.customerPoReference = poRef;
    if (orderDate) body.orderDate = orderDate;
    if (requestedDeliveryDate) body.requestedDeliveryDate = requestedDeliveryDate;
    const deliveryAddr = blankToUndefined(deliveryAddress);
    if (deliveryAddr) body.deliveryAddress = deliveryAddr;
    const sourceText = blankToUndefined(pastedText);
    if (sourceText) body.originalSourceText = sourceText;
    const notes = blankToUndefined(internalNotes);
    if (notes) body.internalNotes = notes;

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: CreateOrderResponse = await response.json();

      if (!response.ok || !data.success || !data.order) {
        setFormError(data.message ?? "Unable to create the order.");
        if (data.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          // Best-effort: surface per-line validation errors (keys of the
          // form "lines.<index>.<field>", indexed within the submitted
          // startedLines array -- not the full lines array, since blank
          // placeholder rows are dropped before sending) on the matching row.
          const lineErrorPattern = /^lines\.(\d+)\./;
          const startedKeys = startedLines.map((line) => line.key);
          setLines((prev) =>
            prev.map((line) => {
              const startedIndex = startedKeys.indexOf(line.key);
              if (startedIndex === -1) return { ...line, error: null };
              const match = Object.entries(data.fieldErrors ?? {}).find(([key]) => {
                const m = key.match(lineErrorPattern);
                return m && Number(m[1]) === startedIndex;
              });
              return match ? { ...line, error: match[1] } : { ...line, error: null };
            })
          );
        }
        setSubmitting(false);
        return;
      }

      setCreatedOrder(data.order);

      if (selectedFiles.length > 0) {
        const initial: DocumentUploadState[] = selectedFiles.map((file) => ({
          file,
          status: "idle",
          message: null,
        }));
        setDocumentUploads(initial);
        for (let i = 0; i < initial.length; i++) {
          // Sequential, not parallel: keeps upload order predictable and
          // the per-file progress list easy to follow, and avoids piling
          // concurrent writes onto the local-disk storage driver for what
          // is, in practice, a handful of files per order.
          await uploadOneDocument(data.order.id, i, initial[i].file);
        }
      }
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (createdOrder) {
    return (
      <div className="min-h-screen bg-[#F7F8F6]">
        <Sidebar />
        <main className="flex min-h-screen items-center justify-center pl-[260px]">
          <div className="w-full max-w-md rounded-xl border border-[#E8EBE6] bg-white p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600">
              <CheckCircle2 size={28} />
            </div>
            <h1 className="mt-4 text-lg font-bold text-[#17251E]">Order Received</h1>
            <p className="mt-2 text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{createdOrder.reference}</span> has been recorded.
            </p>

            {documentUploads.length > 0 && (
              <div className="mt-4 space-y-2 text-left">
                {documentUploads.map((upload, index) => (
                  <div key={`${upload.file.name}-${index}`} className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-gray-600">{upload.file.name}</span>
                      {upload.status === "uploading" && (
                        <Loader2 size={13} className="shrink-0 animate-spin text-gray-400" />
                      )}
                      {upload.status === "success" && (
                        <span className="shrink-0 text-[11px] font-semibold text-green-600">Uploaded</span>
                      )}
                      {upload.status === "error" && (
                        <span className="shrink-0 text-[11px] font-semibold text-red-600">Failed</span>
                      )}
                    </div>
                    {upload.status === "error" && (
                      <div className="mt-1">
                        <p className="text-[11px] text-red-600">{upload.message}</p>
                        <button
                          type="button"
                          onClick={() => uploadOneDocument(createdOrder.id, index, upload.file)}
                          className="mt-1 rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                        >
                          Retry Upload
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex items-center justify-center gap-3">
              <Link
                href={`/orders/${createdOrder.id}`}
                className="rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#24543F]"
              >
                View Order
              </Link>
              <Link
                href="/orders"
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Back to Orders
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Sales Management / Orders / New</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Receive New Order</h2>
          </div>
          <div className="flex items-center gap-5">
            <button className="text-gray-400 hover:text-gray-700">
              <Search size={19} />
            </button>
            <button className="relative text-gray-400 hover:text-gray-700">
              <Bell size={19} />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6 p-8">
          <div className="flex items-center justify-between">
            <Link href="/orders" className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-700">
              <ArrowLeft size={14} />
              Back to Orders
            </Link>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              <AlertCircle size={15} />
              {formError}
            </div>
          )}

          {/* Original message / documents -- optional, combinable with each other and with the manual lines below */}
          <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h2 className="text-[15px] font-bold text-[#17251E]">Original Message &amp; Documents</h2>
            <p className="mt-1 text-xs text-gray-400">
              Both optional, and not mutually exclusive with each other or with the order lines below --
              paste the customer&apos;s message, attach their PO file(s), key in lines manually, or any
              combination. Keeping the original wording and files is what lets someone verify the order
              later. Nothing here is auto-extracted into lines yet (that&apos;s a later milestone), so an
              order submitted with only a message or only a file still waits for a human to add lines.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-6">
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                  <MessageSquare size={13} />
                  Customer&apos;s message or PO text
                </label>
                <textarea
                  value={pastedText}
                  onChange={(event) => setPastedText(event.target.value)}
                  placeholder="Paste the customer's email or WhatsApp message here..."
                  rows={6}
                  maxLength={5000}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-4 py-3 text-xs outline-none focus:border-[#7C9D87] focus:ring-2 focus:ring-green-50"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                  <Upload size={13} />
                  Attach file(s)
                </label>
                <label className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-7 text-center hover:border-[#7C9D87]">
                  <Upload size={20} className="text-gray-400" />
                  <span className="mt-2 text-xs font-medium text-gray-600">
                    {selectedFiles.length > 0
                      ? `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected -- click to add more`
                      : "Click to select the customer's PO file(s)"}
                  </span>
                  <span className="mt-1 text-[10px] text-gray-400">Up to 20 MB each</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      handleFilesPicked(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                </label>
                {selectedFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {selectedFiles.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="flex items-center justify-between gap-2 text-[11px] text-gray-500"
                      >
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeSelectedFile(index)}
                          className="shrink-0 text-gray-300 hover:text-red-600"
                        >
                          <X size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* Customer */}
          <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h2 className="text-[15px] font-bold text-[#17251E]">Customer</h2>

            {selectedCustomer ? (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-gray-700">{selectedCustomer.name}</p>
                  {selectedCustomer.sapCustomerCode && (
                    <p className="text-[10px] text-gray-400">SAP code: {selectedCustomer.sapCustomerCode}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerQuery("");
                  }}
                  className="text-[11px] font-semibold text-gray-400 hover:text-red-600"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative mt-4">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={customerQuery}
                  onChange={(event) => {
                    setCustomerQuery(event.target.value);
                    setShowCustomerResults(true);
                  }}
                  onFocus={() => setShowCustomerResults(true)}
                  placeholder="Search customers by name or SAP code..."
                  className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-4 text-xs outline-none focus:border-[#7C9D87] focus:ring-2 focus:ring-green-50"
                />
                {showCustomerResults && customerQuery.trim() !== "" && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-100 bg-white shadow-lg">
                    {customerSearchLoading && (
                      <p className="px-4 py-3 text-xs text-gray-400">Searching...</p>
                    )}
                    {!customerSearchLoading && customerResults.length === 0 && (
                      <p className="px-4 py-3 text-xs text-gray-400">No customers found.</p>
                    )}
                    {!customerSearchLoading &&
                      customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setShowCustomerResults(false);
                          }}
                          className="block w-full px-4 py-3 text-left text-xs hover:bg-gray-50"
                        >
                          <p className="font-medium text-gray-700">{customer.name}</p>
                          {customer.primaryLocation && (
                            <p className="text-[10px] text-gray-400">{customer.primaryLocation.city}</p>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {selectedCustomer && (
              <div className="mt-4">
                <label className="text-[11px] font-semibold text-gray-500">Delivery Location</label>
                {locationsLoading ? (
                  <p className="mt-1 text-xs text-gray-400">Loading locations...</p>
                ) : locations.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-400">No saved locations for this customer.</p>
                ) : (
                  <select
                    value={customerLocationId}
                    onChange={(event) => setCustomerLocationId(event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                  >
                    <option value="">No specific location</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.label ? `${location.label} — ` : ""}
                        {location.addressLine1}, {location.city}
                        {location.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </section>

          {/* Order details */}
          <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h2 className="text-[15px] font-bold text-[#17251E]">Order Details</h2>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-gray-500">Order Source</label>
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value as "EMAIL" | "WHATSAPP" | "MANUAL")}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                >
                  {Object.entries(ORDER_SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-500">Customer PO Reference</label>
                <input
                  type="text"
                  value={customerPoReference}
                  onChange={(event) => setCustomerPoReference(event.target.value)}
                  placeholder="e.g. PO-219246"
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-500">Order Date</label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={(event) => setOrderDate(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                />
                {fieldErrors.orderDate && <p className="mt-1 text-[11px] text-red-600">{fieldErrors.orderDate}</p>}
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-500">Requested Delivery Date</label>
                <input
                  type="date"
                  value={requestedDeliveryDate}
                  onChange={(event) => setRequestedDeliveryDate(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                />
                {fieldErrors.requestedDeliveryDate && (
                  <p className="mt-1 text-[11px] text-red-600">{fieldErrors.requestedDeliveryDate}</p>
                )}
              </div>

              <div className="col-span-2">
                <label className="text-[11px] font-semibold text-gray-500">Delivery Address / Notes</label>
                <input
                  type="text"
                  value={deliveryAddress}
                  onChange={(event) => setDeliveryAddress(event.target.value)}
                  placeholder="Only needed if different from the selected location"
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                />
              </div>

              <div className="col-span-2">
                <label className="text-[11px] font-semibold text-gray-500">Internal Notes</label>
                <textarea
                  value={internalNotes}
                  onChange={(event) => setInternalNotes(event.target.value)}
                  rows={2}
                  placeholder="Visible to Willsgrove staff only"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-[#7C9D87]"
                />
              </div>
            </div>
          </section>

          {/* Order lines */}
          <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-bold text-[#17251E]">Order Lines</h2>
                <p className="mt-1 text-xs text-gray-400">
                  Optional if you&apos;ve pasted the customer&apos;s message or attached their PO above --
                  those wait for manual review since there&apos;s no automatic extraction yet. Search by SAP
                  code, name or barcode to link a known catalogue item, or enter a line exactly as written
                  on the PO.
                </p>
              </div>
              <button
                type="button"
                onClick={addLine}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
              >
                <Plus size={14} />
                Add Line
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {lines.map((line, index) => (
                <div key={line.key} className="rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-gray-400">Line {index + 1}</p>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="text-gray-300 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {line.error && <p className="mt-1 text-[11px] text-red-600">{line.error}</p>}

                  <div className="mt-2 grid grid-cols-4 gap-3">
                    <div className="relative col-span-2">
                      <label className="text-[10px] font-semibold text-gray-400">
                        Catalogue search (SAP code, name or barcode -- optional)
                      </label>
                      <input
                        type="text"
                        value={line.productQuery}
                        onChange={(event) => handleProductQueryChange(line.key, event.target.value)}
                        onFocus={() => updateLine(line.key, { showSuggestions: true })}
                        placeholder="Search by SAP code, name or barcode..."
                        className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                      />
                      {line.showSuggestions && line.suggestions.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-100 bg-white shadow-lg">
                          {line.suggestions.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => selectProduct(line.key, product)}
                              className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                            >
                              <p className="font-medium text-gray-700">{product.itemName}</p>
                              {product.sapItemCode && (
                                <p className="text-[10px] text-gray-400">{product.sapItemCode}</p>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {line.productId && (
                        <p className="mt-1 text-[10px] text-green-600">
                          Linked to SAP product{line.sapItemCodeSnapshot ? ` (${line.sapItemCodeSnapshot})` : ""}
                        </p>
                      )}
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] font-semibold text-gray-400">
                        Description as written on PO *
                      </label>
                      <input
                        type="text"
                        value={line.originalProductDescription}
                        onChange={(event) =>
                          updateLine(line.key, { originalProductDescription: event.target.value })
                        }
                        placeholder="e.g. Apples G/D Econ 1.5kg"
                        className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-gray-400">Quantity *</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.requestedQuantity}
                        onChange={(event) => updateLine(line.key, { requestedQuantity: event.target.value })}
                        placeholder="10"
                        className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-gray-400">Unit *</label>
                      <input
                        type="text"
                        value={line.requestedUnitCode}
                        onChange={(event) => updateLine(line.key, { requestedUnitCode: event.target.value })}
                        placeholder="KG / EA / BOX"
                        className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-gray-400">Customer&apos;s Price</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.customerUnitPrice}
                        onChange={(event) => updateLine(line.key, { customerUnitPrice: event.target.value })}
                        placeholder="Optional"
                        className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-gray-400">Notes</label>
                      <input
                        type="text"
                        value={line.salesNotes}
                        onChange={(event) => updateLine(line.key, { salesNotes: event.target.value })}
                        placeholder="Optional"
                        className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-[11px] text-gray-500">
              Note: a customer&apos;s submitted price is never treated as the approved selling price. Pricing and
              approval happen in a later step, not built yet in this milestone.
            </p>
          </section>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3">
            <Link
              href="/orders"
              className="rounded-lg border border-gray-200 px-5 py-3 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-5 py-3 text-xs font-semibold text-white transition hover:bg-[#24543F] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? "Submitting..." : "Submit Order"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
