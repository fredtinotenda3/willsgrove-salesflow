/**
 * Shared display helpers for the order-related pages (list/detail/new).
 *
 * Single source of truth for mapping the real Prisma enums -- OrderStatus,
 * OrderSource, VerificationStatus, DocumentType, all defined in
 * prisma/schema.prisma -- to UI labels and styles, so the three order
 * pages can't drift out of sync with each other or with the schema.
 *
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking):
 * PICKING and READY_TO_INVOICE are now real OrderStatus values (added in
 * prisma/migrations/20261110060000_add_picking_sessions) -- this is the
 * "add a status here only after it exists in the schema" moment this
 * file's comment used to point at.
 *
 * Milestone 10 built what the comment above used to call a deferred
 * future milestone: DispatchRecord/DeliveryRecord now exist, with
 * DispatchStatus's own DELIVERED value. "Dispatched"/"Delivered" still
 * are NOT OrderStatus enum values, and getEffectiveOrderStatus below
 * deliberately keeps it that way -- CustomerOrder.status is never
 * changed once it reaches READY_TO_INVOICE (prisma/schema.prisma's own
 * OrderStatus comment documents why: it is the gate for SAP handover,
 * not a terminal state SalesFlow tracks further, and this app never
 * overwrites SAP's own authoritative invoice/delivery status). What was
 * genuinely missing (Final completion phase, section 7: "an order must
 * not remain stuck at Ready for Invoice after it has progressed") is a
 * derived, DISPLAY-ONLY label layered on top of the real status for the
 * UI, computed purely from this order's own DispatchRecord rows --
 * never a second stored status column that could drift out of sync with
 * the real one.
 *
 * Client-safe: no server-only imports and no @prisma/client import (only
 * string-literal unions that mirror the schema's enums), so this can be
 * imported from both Client and Server Components without pulling in the
 * Prisma runtime.
 */

export const ORDER_STATUSES = [
  "RECEIVED",
  "PENDING_VERIFICATION",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "PICKING",
  "READY_TO_INVOICE",
  "REJECTED",
  "CANCELLED",
  "DRAFT",
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  RECEIVED: "Received",
  PENDING_VERIFICATION: "Pending Verification",
  READY_FOR_APPROVAL: "Ready for Approval",
  APPROVED: "Approved",
  PICKING: "Picking",
  READY_TO_INVOICE: "Ready to Invoice",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  DRAFT: "Draft",
};

export const ORDER_STATUS_STYLES: Record<OrderStatusValue, string> = {
  RECEIVED: "bg-blue-50 text-blue-700",
  PENDING_VERIFICATION: "bg-amber-50 text-amber-700",
  READY_FOR_APPROVAL: "bg-purple-50 text-purple-700",
  APPROVED: "bg-green-50 text-green-700",
  PICKING: "bg-cyan-50 text-cyan-700",
  READY_TO_INVOICE: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  DRAFT: "bg-gray-100 text-gray-500",
};

export type EffectiveOrderStatusInput = {
  status: OrderStatusValue | string;
  /**
   * Every non-CANCELLED DispatchRecord.status ("PLANNED" | "DEPARTED" |
   * "DELIVERED") for this order, in any order. Only consulted when
   * `status` is READY_TO_INVOICE -- ignored for every other OrderStatus,
   * since this derivation exists solely to stop READY_TO_INVOICE orders
   * from looking permanently stuck once dispatch/delivery has actually
   * moved on.
   */
  dispatchStatuses: string[];
};

export type EffectiveOrderStatus = { label: string; style: string };

/**
 * See this file's own module comment for the full rationale. Three
 * READY_TO_INVOICE outcomes, derived purely from already-recorded
 * DispatchRecord rows:
 *   - no dispatch yet, or every dispatch still PLANNED (not departed) ->
 *     unchanged "Ready to Invoice" (nothing has actually progressed yet).
 *   - every non-cancelled dispatch is DELIVERED -> "Delivered".
 *   - anything else (at least one DEPARTED or a mix of DEPARTED/DELIVERED
 *     across multiple dispatch batches for the same order) -> "Departed"
 *     (in progress -- has left, not yet fully confirmed delivered).
 * Every other OrderStatus passes straight through unchanged.
 */
export function getEffectiveOrderStatus({ status, dispatchStatuses }: EffectiveOrderStatusInput): EffectiveOrderStatus {
  const baseLabel = (ORDER_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const baseStyle = (ORDER_STATUS_STYLES as Record<string, string>)[status] ?? "bg-gray-100 text-gray-500";

  if (status !== "READY_TO_INVOICE" || dispatchStatuses.length === 0) {
    return { label: baseLabel, style: baseStyle };
  }

  const hasDeparted = dispatchStatuses.some((s) => s !== "PLANNED");
  if (!hasDeparted) {
    return { label: baseLabel, style: baseStyle };
  }

  if (dispatchStatuses.every((s) => s === "DELIVERED")) {
    return { label: "Delivered", style: "bg-teal-50 text-teal-700" };
  }

  return { label: "Departed", style: "bg-orange-50 text-orange-700" };
}

/**
 * Workflow/Navigation/Performance round, Part 3: "a consistent
 * lifecycle/progress indicator on relevant detail pages."
 *
 * Returns the ordered stage list for the one real order lifecycle this
 * codebase actually implements: Received -> Approval ->
 * Picking -> Ready for Invoice -> Invoiced -> Dispatched -> Delivered.
 * (Lost Sales is a branch off Picking, not a stage every order passes
 * through, so it is surfaced separately as a related record rather than
 * as a step here -- same reason Claims/Returns/Credit Notes are related
 * records on the invoice/delivered-order side, not lifecycle steps:
 * neither happens to every order, and both can recur.)
 *
 * This NEVER introduces a second stored status. Steps 0-3 read straight
 * off the real, already-stored `status` (the only thing CustomerOrder.
 * status can express, since it freezes at READY_TO_INVOICE -- see this
 * file's own module comment and prisma/schema.prisma's OrderStatus
 * comment). Steps 4-6 read the three independent signals that are the
 * only way to know what happened AFTER that freeze: whether an SAP
 * invoice has been matched, whether any dispatch has left (or
 * delivered), and whether that invoice's own delivery outcome has been
 * recorded -- exactly the same signals getEffectiveOrderStatus above and
 * lib/delivered-orders/queries.ts already use, never a new definition.
 *
 * Returns null for DRAFT/CANCELLED/REJECTED: these don't progress
 * through the lifecycle at all (DRAFT is never actually produced by
 * lib/orders.ts; CANCELLED/REJECTED are terminal exits), so a linear
 * stepper would misrepresent them -- the existing status badge already
 * communicates these clearly on its own.
 */
export type OrderLifecycleStepState = "done" | "current" | "upcoming";
export type OrderLifecycleStep = { key: string; label: string; state: OrderLifecycleStepState };

export type OrderLifecycleInput = {
  status: OrderStatusValue | string;
  dispatchStatuses: string[];
  hasMatchedInvoice: boolean;
  delivered: boolean;
};

const LIFECYCLE_STAGE_LABELS = [
  "Received",
  "Approval",
  "Picking",
  "Ready for Invoice",
  "Invoiced",
  "Dispatched",
  "Delivered",
] as const;

export function getOrderLifecycleSteps(input: OrderLifecycleInput): OrderLifecycleStep[] | null {
  const { status, dispatchStatuses, hasMatchedInvoice, delivered } = input;

  if (status === "DRAFT" || status === "CANCELLED" || status === "REJECTED") {
    return null;
  }

  const statusStageIndex: Record<string, number> = {
    RECEIVED: 0,
    // Deprecated status: the Pricing & Verification step no longer exists, so any
    // order still sitting in it simply shows as Received.
    PENDING_VERIFICATION: 0,
    READY_FOR_APPROVAL: 1,
    APPROVED: 1,
    PICKING: 2,
    READY_TO_INVOICE: 3,
  };

  let stageIndex = statusStageIndex[status] ?? 0;
  if (hasMatchedInvoice) stageIndex = Math.max(stageIndex, 4);
  if (dispatchStatuses.some((s) => s === "DEPARTED" || s === "DELIVERED")) stageIndex = Math.max(stageIndex, 5);
  // An order is Delivered once EITHER the matched invoice's delivery outcome
  // has been recorded (`delivered`) OR every non-cancelled dispatch has been
  // physically delivered. The second signal matters for the native flow: the
  // header badge (getEffectiveOrderStatus above) already says "Delivered" when
  // every dispatch is DELIVERED, so the stepper must agree with it -- before
  // this, a physically delivered order with no recorded invoice outcome showed
  // a "Delivered" badge beside a stepper whose last step was still pending.
  const allDispatchesDelivered = dispatchStatuses.length > 0 && dispatchStatuses.every((s) => s === "DELIVERED");
  if (delivered || allDispatchesDelivered) stageIndex = Math.max(stageIndex, 6);

  // Real-world fix ("7 Dispatched, 8 Delivered -- not ticking even when
  // marked Delivered"): every stage before `stageIndex` has always been
  // "done" (a tick), and `stageIndex` itself was always "current" (a
  // highlighted number, no tick) -- correct for every stage EXCEPT the
  // last one. "current" means "in progress, something still to reach" --
  // true for Dispatched while still mid-transit, but once `delivered` is
  // true there is nothing further to progress to: Delivered is a
  // completed, terminal fact, not a step still underway, so it must
  // render as "done" (ticked) exactly like every earlier stage, not as
  // the same "current" highlight a merely-in-progress stage gets.
  const lastIndex = LIFECYCLE_STAGE_LABELS.length - 1;

  return LIFECYCLE_STAGE_LABELS.map((label, index) => ({
    key: label,
    label,
    state:
      index < stageIndex || (index === stageIndex && stageIndex === lastIndex)
        ? "done"
        : index === stageIndex
          ? "current"
          : "upcoming",
  }));
}

export const ORDER_SOURCES = ["EMAIL", "WHATSAPP", "MANUAL"] as const;
export type OrderSourceValue = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABELS: Record<OrderSourceValue, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  MANUAL: "Manual",
};

/** Safe lookup for a value that is typed/validated as OrderSourceValue server-side but arrives over the wire as a plain string. */
export function orderSourceLabel(source: string): string {
  return (ORDER_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

export const VERIFICATION_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "VERIFIED", "FLAGGED"] as const;
export type VerificationStatusValue = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatusValue, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  VERIFIED: "Verified",
  FLAGGED: "Flagged",
};

export const VERIFICATION_STATUS_STYLES: Record<VerificationStatusValue, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-500",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  VERIFIED: "bg-green-50 text-green-700",
  FLAGGED: "bg-red-50 text-red-700",
};

export const DOCUMENT_TYPES = ["CUSTOMER_PO", "SUPPORTING_DOCUMENT", "OTHER"] as const;
export type DocumentTypeValue = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentTypeValue, string> = {
  CUSTOMER_PO: "Customer PO",
  SUPPORTING_DOCUMENT: "Supporting Document",
  OTHER: "Other",
};

/**
 * For orderDate/requestedDeliveryDate ONLY -- both are stored as UTC
 * midnight (see lib/dates.ts) and arrive here as that instant's full ISO
 * string (lib/order-queries.ts's `.toISOString()`). Milestone 0 fix
 * (round 5): formatting without an explicit `timeZone` uses the VIEWER'S
 * LOCAL timezone, which can roll UTC midnight back onto the previous
 * calendar day for anyone west of UTC (e.g. 2026-11-09T00:00:00.000Z
 * displays as "8 Nov" in a UTC-5 browser) -- the exact "a date never
 * shifts by timezone" bug asked to be fixed. `timeZone: "UTC"` pins the
 * display to the same calendar day that was actually stored, for every
 * viewer, regardless of where they are. Deliberately NOT applied to
 * formatOrderDateTime below: that one formats real timestamps
 * (receivedAt, createdAt, a document's upload time, ...), where showing
 * the viewer's own local time is correct, expected behaviour, not a bug.
 */
export function formatOrderDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatOrderDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `total` is a nullable Decimal-as-string; null means "not priced yet" (see lib/orders.ts), never zero. */
export function formatOrderAmount(total: string | null, currency: string): string {
  if (total === null) return "Pending pricing";
  const value = Number(total);
  if (!Number.isFinite(value)) return "Pending pricing";
  return `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Real-world fix ("all places with Pending pricing must populate with
 * price... ie Amount column on Workspace / Sales Management / Orders
 * page"): the Orders list's Amount column specifically -- shows the
 * APPROVED total when there is one (unchanged), and otherwise falls back
 * to the order's own estimateOrderTotal (lib/order-queries.ts, summed
 * from each line's customerUnitPrice x requestedQuantity), clearly
 * marked `isEstimate` so the caller can style/label it differently from a
 * real approved amount -- never silently presented as the same thing.
 * Left as a sibling of formatOrderAmount, not a signature change to it,
 * since that function has several OTHER callers (subtotal/taxTotal,
 * quotations, unrelated reporting amounts) this fallback doesn't apply
 * to.
 */
export function formatOrderAmountWithEstimate(
  total: string | null,
  estimatedTotal: string | null,
  estimatedTotalIsPartial: boolean,
  currency: string
): { text: string; isEstimate: boolean; isPartialEstimate: boolean } {
  if (total !== null) {
    return { text: formatOrderAmount(total, currency), isEstimate: false, isPartialEstimate: false };
  }
  if (estimatedTotal === null) {
    return { text: "Pending pricing", isEstimate: false, isPartialEstimate: false };
  }
  const value = Number(estimatedTotal);
  if (!Number.isFinite(value)) {
    return { text: "Pending pricing", isEstimate: false, isPartialEstimate: false };
  }
  const formatted = `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return {
    text: estimatedTotalIsPartial ? `~${formatted}` : formatted,
    isEstimate: true,
    isPartialEstimate: estimatedTotalIsPartial,
  };
}

/**
 * Real-world fix ("Line Total column... should derive from unit price
 * used when creating order, not keep saying Pending"): the per-LINE
 * equivalent of formatOrderAmountWithEstimate above -- same "real value
 * first, clearly-marked estimate second, 'Pending' only when truly
 * nothing is known" shape, simplified since a single line has no
 * partial-estimate concept (it is either priced or it isn't).
 */
export function formatLineAmountWithEstimate(
  lineTotal: string | null,
  estimatedLineTotal: string | null,
  currency: string
): { text: string; isEstimate: boolean } {
  if (lineTotal !== null) {
    return { text: formatOrderAmount(lineTotal, currency), isEstimate: false };
  }
  if (estimatedLineTotal === null) {
    return { text: "Pending", isEstimate: false };
  }
  const value = Number(estimatedLineTotal);
  if (!Number.isFinite(value)) {
    return { text: "Pending", isEstimate: false };
  }
  const formatted = `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return { text: `~${formatted}`, isEstimate: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AVATAR_PALETTE = [
  "bg-orange-100 text-orange-700",
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-teal-100 text-teal-700",
  "bg-green-100 text-green-700",
  "bg-yellow-100 text-yellow-700",
  "bg-pink-100 text-pink-700",
];

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
