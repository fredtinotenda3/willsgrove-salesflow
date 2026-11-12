import "server-only";

/**
 * Milestone 11 (Operational BI). Shared types for the lib/reporting/
 * module -- the server-side reporting layer that sits on top of M0-M10's
 * own data (never a parallel copy of it) and composes already-existing
 * per-module dashboard/query functions rather than re-deriving their
 * business logic (spec section 2's core architectural instruction).
 *
 * Every number this module returns is EITHER a plain count/sum (when
 * there is no ambiguity -- "32 orders are APPROVED right now" needs no
 * qualifier) OR, where the spec explicitly requires distinguishing kinds
 * of figure (section 2: "actual recorded values... calculated values...
 * pending or provisional values... missing or incomplete data"), wrapped
 * in a `QualifiedMetric<T>` that names which kind it is and gives its
 * one-sentence definition. docs/milestones/m11-metric-definitions.md is
 * the full catalogue; this type is how that catalogue's rules reach the
 * API/UI rather than living only in a document nobody reads at runtime.
 */
export type DataQuality = "actual" | "calculated" | "provisional" | "missing";

export type QualifiedMetric<T> = {
  value: T;
  quality: DataQuality;
  /** One sentence: what this is, where it comes from, how it's computed. */
  definition: string;
};

export function qualified<T>(value: T, quality: DataQuality, definition: string): QualifiedMetric<T> {
  return { value, quality, definition };
}

/** A metric this report cannot compute right now because its source data doesn't exist for the selected scope -- e.g. no delivered dispatches in the period, not an invented zero. */
export function missingMetric<T>(placeholder: T, definition: string): QualifiedMetric<T> {
  return { value: placeholder, quality: "missing", definition };
}

/**
 * Shared filter set every M11 report accepts (spec section 8's list),
 * all optional -- an absent filter means "no restriction on this
 * dimension," never "zero/none." `includeDemo` defaults to false
 * everywhere in this codebase (spec section 2: "demo data must remain
 * excluded from operational reporting by default") and is the one
 * exception that already has a default baked into parseReportFilters.
 */
export type ReportFilters = {
  /** Inclusive UTC calendar-day bounds, each "YYYY-MM-DD" or null for "no bound on this side." */
  dateFrom: string | null;
  dateTo: string | null;
  customerId: string | null;
  productId: string | null;
  /** CustomerOrder.salespersonId / Quotation.salespersonId. */
  salespersonId: string | null;
  /**
   * orderStatus/quotationStatus/claimStatus each map onto exactly one
   * schema enum (OrderStatus/QuotationStatus/InvoiceClaimStatus) and are
   * validated against it centrally in lib/reporting/filters.ts's
   * parseReportFilters. Applied for real in the list-shaped reports
   * where narrowing by status adds information (lib/reporting/
   * management-reports.ts's list-kind reports); deliberately NOT applied
   * in the aggregate breakdown reports (sales-pipeline, fulfilment-
   * intelligence, communications-monitoring, financial-exposure's
   * claims/reconciliation sections), each of which already reports a
   * full breakdown by status as its own output -- see each of those
   * files' own top comment for why an equality filter there would
   * collapse the breakdown rather than add anything.
   */
  orderStatus: string | null;
  quotationStatus: string | null;
  /**
   * Not a single schema enum -- depending on which list report consumes
   * it, this is a PickingSessionStatus, DispatchStatus, or
   * DeliveryOutcome value. NOT centrally validated (there is no single
   * valid set); each report function that applies it validates against
   * only its own relevant enum -- see lib/reporting/management-reports.ts's
   * applicableEnumFilter and its call sites in listPickingShortages/
   * listDeliveryExceptions.
   */
  fulfilmentStatus: string | null;
  claimStatus: string | null;
  /**
   * Not a single schema enum -- a MessageIntakeStatus or
   * OutboundMessageStatus value depending on context. Not centrally
   * validated, same reasoning as fulfilmentStatus above. Not currently
   * applied by any report function (see lib/reporting/
   * communications-monitoring.ts and management-reports.ts's
   * listCommunicationFailures for why); kept in this shared type because
   * the filter bar still needs a place to carry it if a future report
   * needs it.
   */
  communicationStatus: string | null;
  includeDemo: boolean;
  /**
   * Milestone 12 (Sales Performance Intelligence). A 3-letter currency
   * code (e.g. "USD", "ZWG") or null for "no restriction." Added
   * because sales-revenue/customer-activity money figures are reported
   * PER CURRENCY and never summed across them (see lib/reporting/
   * sales-revenue.ts's own module comment) -- this lets a user pin the
   * filter bar/export to one currency's figures.
   */
  currency: string | null;
  /** Milestone 12. LostSaleReason enum value or null -- applied by lib/reporting/sales-performance.ts's lost-sales-by-salesperson breakdown. */
  lostSalesReason: string | null;
};

export type PaginationParams = {
  page: number;
  pageSize: number;
};

export type PaginatedResult<T> = {
  rows: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

/** A single stage in a sales-pipeline/funnel view (spec section 4). */
export type PipelineStage = {
  stage: string;
  count: number;
  /** Total value of records in this stage, as a decimal string (never a float), or null when the stage has no natural money total (e.g. "requests received" before anything is priced). */
  totalValue: string | null;
};

/** A drill-down link: where to send the user to see the underlying records behind an aggregate figure (spec sections 4/12 -- "allow users to investigate the underlying records"). Points at an EXISTING list page/API with filters already applied; this module never embeds full record lists itself. */
export type DrillDownLink = {
  label: string;
  href: string;
};
