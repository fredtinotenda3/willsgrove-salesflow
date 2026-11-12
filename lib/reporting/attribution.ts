/**
 * Milestone 12 (Sales Performance Intelligence). Pure classification
 * logic for CustomerOrder.salespersonId provenance -- deliberately split
 * out from lib/reporting/attribution-queries.ts (which does the actual
 * database reads) so THIS file has no @prisma/client import anywhere in
 * its graph and can be unit-tested unconditionally, the exact same split
 * lib/fulfilment/decimal.ts already uses for the same reason: this
 * sandbox's @prisma/client is a stub that throws when merely constructed
 * (see lib/prisma.ts's own comment), so any file that imports it at
 * module scope can only be exercised via the RUN_DB_INTEGRATION_TESTS=1
 * gate every other lib/reporting/*.ts file already uses.
 *
 * Background (the M12 architecture review's central finding): Milestone
 * 11 added CustomerOrder.salespersonId, but lib/orders.ts's
 * createOrderCore silently defaulted it to the order's CREATOR
 * (`input.salespersonId ?? createdById`) on every direct order-creation
 * path, with no audit trail distinguishing "a human deliberately chose
 * this" from "nobody supplied a value, so this is just whoever typed the
 * order in." That default has been removed (see lib/orders.ts), and new
 * order-creation/PO-intake-review pickers (never pre-filled) plus a new
 * `salespersonAssignment` sub-object on the ORDER_CREATE/QUOTATION_CREATED
 * AuditEvent.afterData now give going-forward writes real provenance.
 * This module is how reporting turns that provenance -- or its absence --
 * into a confidence tier, WITHOUT ever assuming `salespersonId !=
 * createdById` by itself proves a deliberate, reliable choice (the
 * explicit instruction this milestone's spec review gave: a manager or
 * administrator could always have picked someone else through the new
 * picker, and the only way to know that pick was real and recorded is to
 * check for the audit record, not to infer it from the field's value).
 *
 * The six buckets:
 *   - UNASSIGNED: salespersonId IS NULL. Ownership is genuinely unknown
 *     and has NOT been defaulted to anything -- never folded into a
 *     confidence tier, reported as its own explicit category.
 *   - VERIFIED: a human recorded, audit-confirmed deliberate choice --
 *     either directly on this order (post-fix direct order with
 *     `salespersonAssignment.source === "explicit"`), or inherited from
 *     a quotation whose OWN creation was itself audit-confirmed (see
 *     classifyQuotationSourcedAttribution -- deliberately checks the
 *     SOURCE QUOTATION's own QUOTATION_CREATED event, never the
 *     converted order's own ORDER_CREATE event, which always looks
 *     "explicit" for a quotation-converted order regardless of whether
 *     the quotation itself was ever a deliberate pick -- see
 *     lib/quotations/convert-to-order.ts, which always supplies a real
 *     value).
 *   - QUOTATION_SOURCED_LEGACY: converted from a quotation created
 *     before the quotation-side provenance fix shipped -- traceable to a
 *     real, required field a human saw, but not audit-confirmed as a
 *     deliberate choice (the quotation form's old pre-fill-to-self
 *     pattern could produce this value without anyone touching the
 *     dropdown).
 *   - UNVERIFIED_LIKELY / UNVERIFIED_SUSPECT: a pre-fix direct order
 *     where salespersonId === createdById (the exact shape the old
 *     silent default produced) -- split by the creator's role at
 *     creation time, since a SALESPERSON entering their own order is a
 *     materially more plausible "this is actually their deal" than a
 *     SALES_MANAGER/ADMINISTRATOR entering on someone's behalf.
 *   - UNVERIFIED_NO_PROVENANCE: salespersonId differs from createdById
 *     (or was set some other way) with NO audit record confirming a
 *     deliberate choice was ever made. A differing value is never, by
 *     itself, read as proof of a reliable choice.
 */

export type AttributionBucket =
  | "VERIFIED"
  | "QUOTATION_SOURCED_LEGACY"
  | "UNVERIFIED_LIKELY"
  | "UNVERIFIED_SUSPECT"
  | "UNVERIFIED_NO_PROVENANCE"
  | "UNASSIGNED";

export const ATTRIBUTION_BUCKETS: readonly AttributionBucket[] = [
  "VERIFIED",
  "QUOTATION_SOURCED_LEGACY",
  "UNVERIFIED_LIKELY",
  "UNVERIFIED_SUSPECT",
  "UNVERIFIED_NO_PROVENANCE",
  "UNASSIGNED",
];

export const ATTRIBUTION_BUCKET_LABELS: Record<AttributionBucket, string> = {
  VERIFIED: "Verified",
  QUOTATION_SOURCED_LEGACY: "Quotation-sourced (legacy)",
  UNVERIFIED_LIKELY: "Unverified (likely correct)",
  UNVERIFIED_SUSPECT: "Unverified (suspect)",
  UNVERIFIED_NO_PROVENANCE: "Unverified (no provenance)",
  UNASSIGNED: "Unassigned",
};

export const ATTRIBUTION_BUCKET_DEFINITIONS: Record<AttributionBucket, string> = {
  VERIFIED:
    "A human recorded, audit-confirmed deliberate choice of salesperson -- either directly on this order, or inherited from a quotation whose own creation was itself audit-confirmed.",
  QUOTATION_SOURCED_LEGACY:
    "Converted from a quotation created before the quotation-side provenance fix shipped -- traceable to a real, required field a human saw, but not audit-confirmed as a deliberate choice.",
  UNVERIFIED_LIKELY:
    "Created before the order-side provenance fix shipped, with no explicit salesperson supplied -- defaulted to the order's creator, who held the SALESPERSON role at creation time.",
  UNVERIFIED_SUSPECT:
    "Created before the order-side provenance fix shipped, with no explicit salesperson supplied -- defaulted to the order's creator, who held the SALES_MANAGER or ADMINISTRATOR role at creation time (most likely entering on a salesperson's behalf).",
  UNVERIFIED_NO_PROVENANCE:
    "salespersonId differs from the order's creator, or was set outside the normal picker flow, with no audit record confirming a deliberate choice was ever made.",
  UNASSIGNED: "salespersonId is NULL -- ownership is genuinely unknown and has not been defaulted to anything.",
};

export type SalespersonAssignmentSource = "explicit" | "unassigned";

export type SalespersonAssignment = {
  salespersonId: string | null;
  source: SalespersonAssignmentSource;
  assignedById: string;
};

/**
 * Parses the `salespersonAssignment` sub-object this milestone adds to
 * ORDER_CREATE/QUOTATION_CREATED AuditEvent.afterData. Returns null for
 * a row with no such sub-object at all -- every pre-fix audit event, by
 * construction -- and that ABSENCE is itself the signal this module
 * relies on; it is never inferred from the order/quotation's current
 * field value. Defensive against a malformed/unexpected shape (an older
 * schema version, a hand-edited row) rather than throwing.
 */
export function readSalespersonAssignment(afterData: unknown): SalespersonAssignment | null {
  if (!afterData || typeof afterData !== "object") return null;
  const record = afterData as Record<string, unknown>;
  const assignment = record.salespersonAssignment;
  if (!assignment || typeof assignment !== "object") return null;

  const a = assignment as Record<string, unknown>;
  if (a.source !== "explicit" && a.source !== "unassigned") return null;
  if (typeof a.assignedById !== "string" || a.assignedById === "") return null;

  let salespersonId: string | null;
  if (a.salespersonId === null) {
    salespersonId = null;
  } else if (typeof a.salespersonId === "string" && a.salespersonId !== "") {
    salespersonId = a.salespersonId;
  } else {
    return null;
  }

  return { salespersonId, source: a.source, assignedById: a.assignedById };
}

export type DirectOrderAttributionInput = {
  salespersonId: string | null;
  createdById: string;
  createdByRole: "SALESPERSON" | "SALES_MANAGER" | "ADMINISTRATOR";
};

/**
 * Classifies a DIRECT order (CustomerOrder.source !== "QUOTATION").
 * `orderCreateAfterData` is this order's OWN ORDER_CREATE
 * AuditEvent.afterData (or null/undefined if one somehow can't be
 * found -- defensive only; createOrderCore always writes one).
 */
export function classifyDirectOrderAttribution(order: DirectOrderAttributionInput, orderCreateAfterData: unknown): AttributionBucket {
  if (order.salespersonId === null) return "UNASSIGNED";

  const assignment = readSalespersonAssignment(orderCreateAfterData);
  if (assignment) {
    // Defensive: an "unassigned" assignment record implies salespersonId
    // should be null, which the check above already caught -- but if a
    // future write path ever disagrees, trust the explicit record over
    // the resolved field value.
    return assignment.source === "unassigned" ? "UNASSIGNED" : "VERIFIED";
  }

  // Pre-fix: no provenance recorded at all. Only the exact shape the old
  // silent default produced (salespersonId === createdById) gets a
  // role-qualified "unverified" tier -- any OTHER mismatch has no
  // explanation on record and is never assumed reliable just because it
  // differs from createdById.
  if (order.salespersonId === order.createdById) {
    return order.createdByRole === "SALESPERSON" ? "UNVERIFIED_LIKELY" : "UNVERIFIED_SUSPECT";
  }
  return "UNVERIFIED_NO_PROVENANCE";
}

/**
 * Classifies a quotation-converted order (CustomerOrder.source ===
 * "QUOTATION"). `quotationCreatedAfterData` MUST be the SOURCE
 * QUOTATION's own QUOTATION_CREATED AuditEvent.afterData -- never the
 * order's own ORDER_CREATE event, which always carries an "explicit"
 * salespersonAssignment for a quotation-converted order (convert-to-
 * order.ts always supplies a real value, inherited from the quotation)
 * and so can never distinguish a deliberate pick from an inherited
 * default. Quotation.salespersonId is a required DB field, so this
 * never needs an UNASSIGNED branch -- a quotation-sourced order's
 * salespersonId is never null.
 */
export function classifyQuotationSourcedAttribution(quotationCreatedAfterData: unknown): AttributionBucket {
  const assignment = readSalespersonAssignment(quotationCreatedAfterData);
  return assignment?.source === "explicit" ? "VERIFIED" : "QUOTATION_SOURCED_LEGACY";
}

export type OrderAttributionContext = DirectOrderAttributionInput & {
  /** CustomerOrder.source, e.g. "QUOTATION" | "EMAIL" | "WHATSAPP" | "MANUAL" | "PDF" | "IMAGE" | "EXCEL" | "CSV". */
  source: string;
};

/**
 * The single entry point lib/reporting/attribution-queries.ts calls per
 * order, once both AuditEvent lookups it needs have been bulk-fetched.
 * Routes to classifyDirectOrderAttribution or
 * classifyQuotationSourcedAttribution purely based on `order.source`,
 * never on whether salespersonId happens to be set -- a quotation-
 * sourced order with a null salespersonId (which should never happen
 * given the schema, but is handled defensively) still reports UNASSIGNED
 * rather than being misrouted into the quotation branch.
 */
export function classifyOrderAttribution(
  order: OrderAttributionContext,
  context: { orderCreateAfterData: unknown; quotationCreatedAfterData?: unknown }
): AttributionBucket {
  if (order.salespersonId === null) return "UNASSIGNED";
  if (order.source === "QUOTATION") {
    return classifyQuotationSourcedAttribution(context.quotationCreatedAfterData ?? null);
  }
  return classifyDirectOrderAttribution(order, context.orderCreateAfterData);
}
