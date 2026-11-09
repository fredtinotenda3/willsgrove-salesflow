/**
 * Shared display helpers for the order-related pages (list/detail/new).
 *
 * Single source of truth for mapping the real Prisma enums -- OrderStatus,
 * OrderSource, VerificationStatus, DocumentType, all defined in
 * prisma/schema.prisma -- to UI labels and styles, so the three order
 * pages can't drift out of sync with each other or with the schema. In
 * particular: OrderStatus has no "Picking" / "Dispatched" / "Delivered"
 * value (those were only ever in the old mock data) -- add a status here
 * only after it exists in the schema.
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
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  DRAFT: "Draft",
};

export const ORDER_STATUS_STYLES: Record<OrderStatusValue, string> = {
  RECEIVED: "bg-blue-50 text-blue-700",
  PENDING_VERIFICATION: "bg-amber-50 text-amber-700",
  READY_FOR_APPROVAL: "bg-purple-50 text-purple-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  DRAFT: "bg-gray-100 text-gray-500",
};

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
