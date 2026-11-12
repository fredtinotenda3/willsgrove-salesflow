"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  Store,
  X,
  XCircle,
} from "lucide-react";
import Sidebar from "../../../../components/sidebar";

/**
 * Milestone 2B. The review workspace: a human resolves the customer
 * match, resolves/overrides each line's product match, excludes any
 * line that isn't a real order line, acknowledges any duplicate
 * warning, and confirms -- which is the one action that turns this
 * document into a real CustomerOrder (POST .../review/confirm). Nothing
 * before that confirm click writes anything.
 *
 * Milestone 2C: multi-store splitting. A line can additionally be
 * tagged with a DIFFERENT store/customer than the document's own
 * resolved one (see the "Assign to a different store" control on each
 * line below) -- lib/review/confirm-review.ts groups accepted lines by
 * their effective customer and creates one CustomerOrder per group, so
 * one submitted document can become several separate confirmed orders.
 */

type MatchCandidateBase = { score: number };
type ProductCandidate = MatchCandidateBase & { productId: string; sapItemCode: string; itemName: string };
type CustomerCandidate = MatchCandidateBase & { customerId: string; name: string; storeCode: string | null; sapCustomerCode: string | null };

type ReviewLine = {
  id: string;
  lineNumber: number;
  originalDescription: string;
  extractedQuantity: string | null;
  extractedUnit: string | null;
  customerProvidedUnitPrice: string | null;
  extractionConfidence: number | null;
  extractionWarnings: string[];
  matchedProductId: string | null;
  matchedProduct: { id: string; sapItemCode: string; itemName: string } | null;
  matchConfidence: number | null;
  matchSource: "NONE" | "ALIAS" | "FUZZY" | "MANUAL";
  matchCandidates: ProductCandidate[];
  status: "PENDING" | "ACCEPTED" | "EXCLUDED";
};

type DuplicateWarning = { kind: string; existingOrderId: string; existingOrderReference: string; message: string };

type ReviewSession = {
  documentId: string;
  extractionRunId: string;
  alreadyConfirmed: boolean;
  confirmedOrderId: string | null;
  confirmedOrderReference: string | null;
  header: {
    customerNameRaw: string | null;
    storeOrBranchRaw: string | null;
    customerPoNumber: string | null;
    poDate: string | null;
    requestedDeliveryDate: string | null;
    deliveryAddressRaw: string | null;
    currencyRaw: string | null;
    senderInfoRaw: string | null;
  };
  customerMatch: {
    matchedCustomerId: string | null;
    matchedCustomer: CustomerCandidate | null;
    matchConfidence: number | null;
    matchSource: "NONE" | "ALIAS" | "FUZZY";
    candidates: CustomerCandidate[];
  };
  lines: ReviewLine[];
  duplicateWarnings: DuplicateWarning[];
};

type LineEditState = {
  decision: "ACCEPTED" | "EXCLUDED";
  productId: string | null;
  productLabel: string;
  requestedQuantity: string;
  requestedUnitCode: string;
  salesNotes: string;
  // Milestone 2C: multi-store splitting. null (the overwhelmingly common
  // case) means "this line belongs to the document's own resolved
  // customer" -- omitted entirely from the confirm payload. Set only
  // when this line actually belongs to a DIFFERENT store than the rest
  // of the document.
  customerOverrideId: string | null;
  customerOverrideLabel: string;
};

type ConfirmedOrderEntry = { orderId: string; orderReference: string; customerId: string };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function matchSourceLabel(source: string): string {
  switch (source) {
    case "ALIAS":
      return "Learned alias";
    case "FUZZY":
      return "Best guess";
    case "MANUAL":
      return "Manually set";
    default:
      return "No match";
  }
}

function confidencePct(score: number | null): string {
  return score !== null ? `${Math.round(score * 100)}%` : "—";
}

function lineEditFromSession(line: ReviewLine): LineEditState {
  return {
    decision: line.status === "EXCLUDED" ? "EXCLUDED" : "ACCEPTED",
    productId: line.matchedProductId,
    productLabel: line.matchedProduct ? `${line.matchedProduct.sapItemCode} — ${line.matchedProduct.itemName}` : "",
    requestedQuantity: line.extractedQuantity ?? "",
    requestedUnitCode: line.extractedUnit ?? "",
    salesNotes: "",
    customerOverrideId: null,
    customerOverrideLabel: "",
  };
}

/** Minimal debounced type-ahead search against an existing list endpoint (customers or products). Intentionally no new backend route -- Milestone 2B reuses GET /api/customers and GET /api/products as-is. */
function usePicker<T>(url: (search: string) => string, extract: (body: Record<string, unknown>) => T[]) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(value: string) {
    setQuery(value);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(url(value.trim()), { cache: "no-store" });
        const body = await readJson(response);
        setResults(response.ok && body.success ? extract(body) : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  return { query, setQuery, results, open, setOpen, loading, search };
}

export default function ReviewWorkspacePage() {
  const params = useParams<{ id: string }>();
  const documentId = params.id;

  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState<string>("");
  const [customerAliasText, setCustomerAliasText] = useState<string>("");

  const [headerFields, setHeaderFields] = useState({
    customerPoReference: "",
    orderDate: "",
    requestedDeliveryDate: "",
    deliveryAddress: "",
    currency: "USD",
    internalNotes: "",
  });

  // Milestone 12 (Sales Performance Intelligence). Same "starts blank,
  // never pre-filled" picker as app/orders/new/page.tsx -- see that
  // file's own comment and CustomerOrder.salespersonId's schema
  // comment. Applied uniformly to every order this confirm creates
  // (there can be more than one -- Milestone 2C's multi-store split).
  const [salespersonId, setSalespersonId] = useState("");
  const [salespeople, setSalespeople] = useState<{ id: string; name: string; role: string; status: string }[]>([]);

  useEffect(() => {
    fetch("/api/users", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSalespeople(
            (data.users ?? []).filter(
              (u: { role: string; status: string }) => u.status === "ACTIVE" && (u.role === "SALESPERSON" || u.role === "SALES_MANAGER")
            )
          );
        }
      })
      .catch(() => {});
  }, []);

  const [lineEdits, setLineEdits] = useState<Record<string, LineEditState>>({});
  const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [liveDuplicateWarnings, setLiveDuplicateWarnings] = useState<DuplicateWarning[] | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<{ id: string; reference: string } | null>(null);
  // Milestone 2C: multi-store splitting. All orders the confirm actually
  // created (always at least one; confirmedOrder above stays the
  // PRIMARY one for backward-compatible rendering when there's only
  // one). customerLabelsAtConfirm snapshots each order's customer name
  // at the moment of confirming, since the response only carries ids.
  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrderEntry[] | null>(null);
  const [customerLabelsAtConfirm, setCustomerLabelsAtConfirm] = useState<Record<string, string>>({});

  const [activeProductPickerLineId, setActiveProductPickerLineId] = useState<string | null>(null);
  const [activeLineCustomerPickerLineId, setActiveLineCustomerPickerLineId] = useState<string | null>(null);

  const customerPicker = usePicker<{ id: string; name: string; sapCustomerCode: string | null }>(
    (search) => `/api/customers?search=${encodeURIComponent(search)}&pageSize=10`,
    (body) => (body.customers as { id: string; name: string; sapCustomerCode: string | null }[]) ?? []
  );
  const productPicker = usePicker<{ id: string; sapItemCode: string; itemName: string }>(
    (search) => `/api/products?search=${encodeURIComponent(search)}&pageSize=10`,
    (body) => (body.products as { id: string; sapItemCode: string; itemName: string }[]) ?? []
  );
  // Milestone 2C: a SEPARATE picker instance from customerPicker above --
  // that one resolves the document's own default customer; this one
  // resolves a per-line override to a different store, and the two must
  // never share query/results state.
  const lineCustomerPicker = usePicker<{ id: string; name: string; sapCustomerCode: string | null }>(
    (search) => `/api/customers?search=${encodeURIComponent(search)}&pageSize=10`,
    (body) => (body.customers as { id: string; name: string; sapCustomerCode: string | null }[]) ?? []
  );

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/po-intake/${documentId}/review`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setLoadError((body.message as string) ?? "Unable to load the review workspace for this document.");
        return;
      }
      const loaded = body.session as ReviewSession;
      setSession(loaded);
      setCustomerId(loaded.customerMatch.matchedCustomerId);
      setCustomerLabel(loaded.customerMatch.matchedCustomer?.name ?? "");
      setHeaderFields({
        customerPoReference: loaded.header.customerPoNumber ?? "",
        orderDate: loaded.header.poDate ?? "",
        requestedDeliveryDate: loaded.header.requestedDeliveryDate ?? "",
        deliveryAddress: loaded.header.deliveryAddressRaw ?? "",
        currency: /^[A-Za-z]{3}$/.test(loaded.header.currencyRaw ?? "") ? (loaded.header.currencyRaw as string).toUpperCase() : "USD",
        internalNotes: "",
      });
      const edits: Record<string, LineEditState> = {};
      for (const line of loaded.lines) edits[line.id] = lineEditFromSession(line);
      setLineEdits(edits);
      setAcknowledgeDuplicate(false);
      setLiveDuplicateWarnings(null);
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  function updateLine(lineId: string, patch: Partial<LineEditState>) {
    setLineEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId]!, ...patch } }));
  }

  async function handleConfirm(forceAcknowledge?: boolean) {
    if (!session) return;
    setConfirming(true);
    setConfirmError(null);
    setFieldErrors({});

    const payload = {
      customerId,
      customerLocationId: null,
      customerAliasText: customerAliasText.trim() === "" ? null : customerAliasText.trim(),
      // Milestone 12 (Sales Performance Intelligence). "" maps to null --
      // never omitted as undefined and never actorId -- so the server
      // always receives an explicit "leave unassigned" when nothing was
      // picked, same as app/orders/new/page.tsx.
      salespersonId: salespersonId === "" ? null : salespersonId,
      header: {
        customerPoReference: headerFields.customerPoReference.trim() === "" ? null : headerFields.customerPoReference.trim(),
        orderDate: headerFields.orderDate.trim() === "" ? null : headerFields.orderDate.trim(),
        requestedDeliveryDate: headerFields.requestedDeliveryDate.trim() === "" ? null : headerFields.requestedDeliveryDate.trim(),
        deliveryAddress: headerFields.deliveryAddress.trim() === "" ? null : headerFields.deliveryAddress.trim(),
        currency: headerFields.currency.trim() === "" ? undefined : headerFields.currency.trim().toUpperCase(),
        internalNotes: headerFields.internalNotes.trim() === "" ? null : headerFields.internalNotes.trim(),
      },
      lines: session.lines.map((line) => {
        const edit = lineEdits[line.id]!;
        return {
          extractedOrderLineId: line.id,
          decision: edit.decision,
          productId: edit.productId,
          requestedQuantity: edit.requestedQuantity.trim() === "" ? null : edit.requestedQuantity.trim(),
          requestedUnitCode: edit.requestedUnitCode.trim() === "" ? null : edit.requestedUnitCode.trim(),
          salesNotes: edit.salesNotes.trim() === "" ? null : edit.salesNotes.trim(),
          // Milestone 2C: multi-store splitting. Omitted entirely (not
          // sent as null -- confirm-review-validation.ts's schema takes
          // it as optional, not nullable) unless this line was tagged
          // with a different store.
          ...(edit.customerOverrideId ? { customerId: edit.customerOverrideId } : {}),
        };
      }),
      acknowledgeDuplicate: forceAcknowledge ?? acknowledgeDuplicate,
    };

    // Snapshot every customer label this confirm could produce an order
    // for, so the success view can show a human-readable name per order
    // without a second round trip -- the API response only carries ids.
    const labelsAtConfirm: Record<string, string> = {};
    if (customerId) labelsAtConfirm[customerId] = customerLabel;
    for (const edit of Object.values(lineEdits)) {
      if (edit.customerOverrideId) labelsAtConfirm[edit.customerOverrideId] = edit.customerOverrideLabel;
    }

    try {
      const response = await fetch(`/api/po-intake/${documentId}/review/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await readJson(response);

      if (response.ok && body.success) {
        setConfirmedOrder({ id: body.orderId as string, reference: body.orderReference as string });
        setConfirmedOrders((body.orders as ConfirmedOrderEntry[] | undefined) ?? null);
        setCustomerLabelsAtConfirm(labelsAtConfirm);
        return;
      }

      if (response.status === 409 && Array.isArray(body.duplicateWarnings) && (body.duplicateWarnings as unknown[]).length > 0) {
        setLiveDuplicateWarnings(body.duplicateWarnings as DuplicateWarning[]);
        setConfirmError((body.message as string) ?? "This looks like a possible duplicate.");
        return;
      }

      setFieldErrors((body.fieldErrors as Record<string, string>) ?? {});
      setConfirmError((body.message as string) ?? "Unable to confirm this document into an order.");
    } catch {
      setConfirmError("Could not reach the server.");
    } finally {
      setConfirming(false);
    }
  }

  const acceptedCount = Object.values(lineEdits).filter((edit) => edit.decision === "ACCEPTED").length;
  const duplicateWarningsToShow = liveDuplicateWarnings ?? session?.duplicateWarnings ?? [];

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / Orders / PO intake / Review</p>
            <h1 className="mt-1 text-lg font-semibold">Review &amp; confirm (Milestone 2B)</h1>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E5EAE4] bg-white px-3 py-2 text-xs font-medium hover:bg-[#F7F8F6] disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </header>

        <div className="mx-auto max-w-[1100px] p-5 md:p-9">
          <Link
            href="/orders/intake"
            className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]"
          >
            <ArrowLeft size={15} />
            Back to PO intake
          </Link>

          {loading && !session ? (
            <p className="text-sm text-[#7D8981]">Loading…</p>
          ) : loadError ? (
            <div className="flex items-start gap-2 rounded-xl border border-[#F1D9D9] bg-[#FFF6F6] px-4 py-3 text-sm text-[#9B3B3B]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{loadError}</p>
            </div>
          ) : session ? (
            <>
              {(confirmedOrder || session.alreadyConfirmed) && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#D9EFE0] bg-[#F0FBF4] px-4 py-3 text-sm text-[#1F7A43]">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                  {confirmedOrders && confirmedOrders.length > 1 ? (
                    <div>
                      <p className="mb-1">
                        This document was split into {confirmedOrders.length} orders across {confirmedOrders.length} stores:
                      </p>
                      <ul className="space-y-0.5">
                        {confirmedOrders.map((order) => (
                          <li key={order.orderId}>
                            <Link href={`/orders/${order.orderId}`} className="font-semibold underline">
                              {order.orderReference}
                            </Link>
                            {customerLabelsAtConfirm[order.customerId] && (
                              <span className="text-[#1F7A43]/80"> — {customerLabelsAtConfirm[order.customerId]}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p>
                      This document is confirmed as order{" "}
                      <Link
                        href={`/orders/${confirmedOrder?.id ?? session.confirmedOrderId}`}
                        className="font-semibold underline"
                      >
                        {confirmedOrder?.reference ?? session.confirmedOrderReference}
                      </Link>
                      .
                    </p>
                  )}
                </div>
              )}

              <fieldset disabled={Boolean(confirmedOrder) || session.alreadyConfirmed} className="space-y-6 disabled:opacity-60">
                {/* Customer match */}
                <section className="rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Customer</h2>
                    <span className="text-xs text-[#89948D]">
                      {matchSourceLabel(session.customerMatch.matchSource)}
                      {session.customerMatch.matchConfidence !== null && ` · ${confidencePct(session.customerMatch.matchConfidence)}`}
                    </span>
                  </div>

                  <p className="mb-3 text-xs text-[#89948D]">
                    From the document: <span className="text-[#17251E]">{session.header.customerNameRaw ?? "—"}</span>
                    {session.header.storeOrBranchRaw && <> · {session.header.storeOrBranchRaw}</>}
                  </p>

                  <div className="relative">
                    <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2">
                      <Search size={14} className="text-[#89948D]" />
                      <input
                        value={customerPicker.query || customerLabel}
                        onChange={(event) => {
                          setCustomerLabel(event.target.value);
                          customerPicker.search(event.target.value);
                        }}
                        onFocus={() => customerPicker.setOpen(true)}
                        placeholder="Search customers by name or SAP code…"
                        className="w-full border-none text-sm outline-none"
                      />
                      {customerPicker.loading && <Loader2 size={14} className="animate-spin text-[#89948D]" />}
                    </div>
                    {customerPicker.open && customerPicker.results.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#E5EAE4] bg-white shadow-lg">
                        {customerPicker.results.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => {
                              setCustomerId(candidate.id);
                              setCustomerLabel(candidate.name);
                              customerPicker.setQuery("");
                              customerPicker.setOpen(false);
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-[#F7F8F6]"
                          >
                            {candidate.name}
                            {candidate.sapCustomerCode && <span className="text-[#89948D]"> · {candidate.sapCustomerCode}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!customerId && (
                    <p className="mt-2 text-xs text-[#9A6B10]">No customer resolved yet -- search and select one above.</p>
                  )}
                  {fieldErrors.customerId && <p className="mt-2 text-xs text-[#9B3B3B]">{fieldErrors.customerId}</p>}

                  {session.customerMatch.candidates.length > 1 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {session.customerMatch.candidates.slice(0, 5).map((candidate) => (
                        <button
                          key={candidate.customerId}
                          type="button"
                          onClick={() => {
                            setCustomerId(candidate.customerId);
                            setCustomerLabel(candidate.name);
                          }}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            customerId === candidate.customerId ? "border-[#10271F] bg-[#10271F] text-white" : "border-[#E5EAE4] text-[#5E7366]"
                          }`}
                        >
                          {candidate.name} ({confidencePct(candidate.score)})
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-4">
                    <label className="mb-1 block text-xs font-medium text-[#5E7366]">
                      Remember this text as the customer&apos;s alias (optional)
                    </label>
                    <input
                      value={customerAliasText}
                      onChange={(event) => setCustomerAliasText(event.target.value)}
                      placeholder="e.g. a nickname used on future orders from this customer"
                      className="w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
                    />
                  </div>
                </section>

                {/* Header fields */}
                <section className="rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  <h2 className="mb-3 text-sm font-semibold">Order details</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                    <HeaderInput
                      label="Customer PO reference"
                      value={headerFields.customerPoReference}
                      onChange={(value) => setHeaderFields((prev) => ({ ...prev, customerPoReference: value }))}
                    />
                    <HeaderInput
                      label="Order date"
                      type="date"
                      value={headerFields.orderDate}
                      onChange={(value) => setHeaderFields((prev) => ({ ...prev, orderDate: value }))}
                    />
                    <HeaderInput
                      label="Requested delivery date"
                      type="date"
                      value={headerFields.requestedDeliveryDate}
                      onChange={(value) => setHeaderFields((prev) => ({ ...prev, requestedDeliveryDate: value }))}
                    />
                    <HeaderInput
                      label="Currency"
                      value={headerFields.currency}
                      onChange={(value) => setHeaderFields((prev) => ({ ...prev, currency: value }))}
                    />
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#89948D]">Salesperson</label>
                      <select
                        value={salespersonId}
                        onChange={(event) => setSalespersonId(event.target.value)}
                        className="w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
                      >
                        <option value="">— Unassigned —</option>
                        {salespeople.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <HeaderInput
                      label="Delivery address"
                      value={headerFields.deliveryAddress}
                      onChange={(value) => setHeaderFields((prev) => ({ ...prev, deliveryAddress: value }))}
                    />
                    <HeaderInput
                      label="Internal notes"
                      value={headerFields.internalNotes}
                      onChange={(value) => setHeaderFields((prev) => ({ ...prev, internalNotes: value }))}
                    />
                  </div>
                </section>

                {/* Duplicate warnings */}
                {duplicateWarningsToShow.length > 0 && (
                  <section className="rounded-2xl border border-[#F1D9D9] bg-[#FFF6F6] p-6">
                    <div className="mb-2 flex items-start gap-2 text-sm font-semibold text-[#9B3B3B]">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      Possible duplicate
                    </div>
                    <ul className="mb-3 space-y-1 text-sm text-[#9B3B3B]">
                      {duplicateWarningsToShow.map((warning, index) => (
                        <li key={`${warning.kind}-${index}`}>{warning.message}</li>
                      ))}
                    </ul>
                    <label className="flex items-center gap-2 text-sm text-[#17251E]">
                      <input
                        type="checkbox"
                        checked={acknowledgeDuplicate}
                        onChange={(event) => setAcknowledgeDuplicate(event.target.checked)}
                      />
                      I&apos;ve checked -- this is not a duplicate, confirm anyway.
                    </label>
                  </section>
                )}

                {/* Lines */}
                <section className="rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Lines ({session.lines.length})</h2>
                    <span className="text-xs text-[#89948D]">{acceptedCount} accepted</span>
                  </div>

                  <div className="space-y-4">
                    {session.lines.map((line) => {
                      const edit = lineEdits[line.id];
                      if (!edit) return null;
                      return (
                        <div
                          key={line.id}
                          className={`rounded-xl border p-4 ${edit.decision === "EXCLUDED" ? "border-[#E5EAE4] bg-[#F7F8F6] opacity-60" : "border-[#E8ECE7]"}`}
                        >
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs text-[#89948D]">Line {line.lineNumber}</p>
                              <p className="font-medium">{line.originalDescription}</p>
                              {line.extractionWarnings.length > 0 && (
                                <p className="mt-0.5 text-xs text-[#9A6B10]">{line.extractionWarnings.join(" ")}</p>
                              )}
                            </div>
                            <div className="flex shrink-0 gap-1 text-xs font-medium">
                              <button
                                type="button"
                                onClick={() => updateLine(line.id, { decision: "ACCEPTED" })}
                                className={`rounded-lg px-3 py-1.5 ${edit.decision === "ACCEPTED" ? "bg-[#10271F] text-white" : "border border-[#E5EAE4] text-[#5E7366]"}`}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => updateLine(line.id, { decision: "EXCLUDED" })}
                                className={`rounded-lg px-3 py-1.5 ${edit.decision === "EXCLUDED" ? "bg-[#9B3B3B] text-white" : "border border-[#E5EAE4] text-[#5E7366]"}`}
                              >
                                Exclude
                              </button>
                            </div>
                          </div>

                          {edit.decision === "ACCEPTED" && (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px_100px]">
                              <div className="relative">
                                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#89948D]">
                                  Matched product ({matchSourceLabel(line.matchSource)}
                                  {line.matchConfidence !== null && ` · ${confidencePct(line.matchConfidence)}`})
                                </label>
                                <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2">
                                  <Search size={13} className="text-[#89948D]" />
                                  <input
                                    value={activeProductPickerLineId === line.id ? productPicker.query : edit.productLabel}
                                    onChange={(event) => {
                                      setActiveProductPickerLineId(line.id);
                                      updateLine(line.id, { productLabel: event.target.value, productId: null });
                                      productPicker.search(event.target.value);
                                    }}
                                    onFocus={() => {
                                      setActiveProductPickerLineId(line.id);
                                      productPicker.setOpen(true);
                                    }}
                                    placeholder="Search products…"
                                    className="w-full border-none text-sm outline-none"
                                  />
                                </div>
                                {activeProductPickerLineId === line.id && productPicker.open && productPicker.results.length > 0 && (
                                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#E5EAE4] bg-white shadow-lg">
                                    {productPicker.results.map((candidate) => (
                                      <button
                                        key={candidate.id}
                                        type="button"
                                        onClick={() => {
                                          updateLine(line.id, {
                                            productId: candidate.id,
                                            productLabel: `${candidate.sapItemCode} — ${candidate.itemName}`,
                                          });
                                          productPicker.setQuery("");
                                          productPicker.setOpen(false);
                                          setActiveProductPickerLineId(null);
                                        }}
                                        className="block w-full px-3 py-2 text-left text-sm hover:bg-[#F7F8F6]"
                                      >
                                        {candidate.sapItemCode} — {candidate.itemName}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {!edit.productId && (
                                  <p className="mt-1 text-xs text-[#9A6B10]">No product selected -- this line will have no SAP item code.</p>
                                )}
                                {line.matchCandidates.length > 1 && (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {line.matchCandidates.slice(0, 4).map((candidate) => (
                                      <button
                                        key={candidate.productId}
                                        type="button"
                                        onClick={() =>
                                          updateLine(line.id, {
                                            productId: candidate.productId,
                                            productLabel: `${candidate.sapItemCode} — ${candidate.itemName}`,
                                          })
                                        }
                                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                                          edit.productId === candidate.productId
                                            ? "border-[#10271F] bg-[#10271F] text-white"
                                            : "border-[#E5EAE4] text-[#5E7366]"
                                        }`}
                                      >
                                        {candidate.sapItemCode} ({confidencePct(candidate.score)})
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div>
                                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#89948D]">Qty</label>
                                <input
                                  value={edit.requestedQuantity}
                                  onChange={(event) => updateLine(line.id, { requestedQuantity: event.target.value })}
                                  className="w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#89948D]">Unit</label>
                                <input
                                  value={edit.requestedUnitCode}
                                  onChange={(event) => updateLine(line.id, { requestedUnitCode: event.target.value })}
                                  className="w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
                                />
                              </div>
                            </div>
                          )}

                          {/* Milestone 2C: multi-store splitting -- tag this one line as
                              belonging to a DIFFERENT store than the rest of the document. */}
                          {edit.decision === "ACCEPTED" && (
                            <div className="mt-3">
                              {edit.customerOverrideId ? (
                                <div className="flex items-center gap-2 rounded-lg border border-[#E5D9A6] bg-[#FFFBEF] px-3 py-2 text-xs text-[#7A5E10]">
                                  <Store size={13} className="shrink-0" />
                                  <span>
                                    Different store: <span className="font-medium">{edit.customerOverrideLabel}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => updateLine(line.id, { customerOverrideId: null, customerOverrideLabel: "" })}
                                    className="ml-auto text-[#7A5E10] hover:text-[#9B3B3B]"
                                    aria-label="Clear store override for this line"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              ) : activeLineCustomerPickerLineId === line.id ? (
                                <div className="relative">
                                  <div className="flex items-center gap-2 rounded-lg border border-[#E5EAE4] px-3 py-2">
                                    <Search size={13} className="text-[#89948D]" />
                                    <input
                                      autoFocus
                                      value={lineCustomerPicker.query}
                                      onChange={(event) => lineCustomerPicker.search(event.target.value)}
                                      placeholder="Search for the store this line actually belongs to…"
                                      className="w-full border-none text-sm outline-none"
                                    />
                                    {lineCustomerPicker.loading && <Loader2 size={13} className="animate-spin text-[#89948D]" />}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveLineCustomerPickerLineId(null);
                                        lineCustomerPicker.setQuery("");
                                      }}
                                      className="text-[#89948D] hover:text-[#17251E]"
                                      aria-label="Cancel store assignment"
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                  {lineCustomerPicker.results.length > 0 && (
                                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#E5EAE4] bg-white shadow-lg">
                                      {lineCustomerPicker.results.map((candidate) => (
                                        <button
                                          key={candidate.id}
                                          type="button"
                                          onClick={() => {
                                            updateLine(line.id, { customerOverrideId: candidate.id, customerOverrideLabel: candidate.name });
                                            setActiveLineCustomerPickerLineId(null);
                                            lineCustomerPicker.setQuery("");
                                          }}
                                          className="block w-full px-3 py-2 text-left text-sm hover:bg-[#F7F8F6]"
                                        >
                                          {candidate.name}
                                          {candidate.sapCustomerCode && <span className="text-[#89948D]"> · {candidate.sapCustomerCode}</span>}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setActiveLineCustomerPickerLineId(line.id)}
                                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#5E7366] hover:text-[#315C43]"
                                >
                                  <Store size={12} />
                                  Assign to a different store
                                </button>
                              )}
                            </div>
                          )}

                          {edit.decision === "EXCLUDED" && (
                            <div>
                              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#89948D]">
                                Why is this line excluded? (optional)
                              </label>
                              <input
                                value={edit.salesNotes}
                                onChange={(event) => updateLine(line.id, { salesNotes: event.target.value })}
                                placeholder="e.g. not a real order line, duplicate of line 3…"
                                className="w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {confirmError && (
                  <div className="flex items-start gap-2 rounded-xl border border-[#F1D9D9] bg-[#FFF6F6] px-4 py-3 text-sm text-[#9B3B3B]">
                    <XCircle size={16} className="mt-0.5 shrink-0" />
                    <p>{confirmError}</p>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={confirming || !customerId || acceptedCount === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#D7F36B] px-5 py-2.5 text-sm font-semibold text-[#10271F] hover:brightness-95 disabled:opacity-50"
                  >
                    {confirming ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    {confirming ? "Confirming…" : "Confirm order"}
                  </button>
                </div>
              </fieldset>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function HeaderInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#89948D]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
      />
    </div>
  );
}
