import "server-only";
import { isValidDateOnlyString, dateOnlyStringToUtcDate, utcDateToDateOnlyString } from "@/lib/dates";
import { ORDER_STATUSES } from "@/lib/order-display";
import { QUOTATION_STATUS_LABELS } from "@/lib/quotations/display";
import { CLAIM_STATUS_LABELS } from "@/lib/invoice-claims/display";
import { LOST_SALE_REASON_LABELS } from "@/lib/lost-sales/display";
import type { ReportFilters, PaginationParams } from "@/lib/reporting/types";

/**
 * Milestone 11 (Operational BI). Parses the shared filter/pagination
 * query-string shape every app/api/reports/* route accepts (spec
 * section 8). Deliberately its own parser, not a retrofit of the
 * several already-existing per-module parsers (lib/order-queries.ts's
 * parseOrderListQuery, lib/quotations/queries.ts's own parser, etc.) --
 * touching those risks regressing M0-M10 routes that already work, and
 * this module's filter set is a strict superset of any one of them
 * (date range, customer, product, salesperson, four different status
 * dimensions). The *shape* (page/pageSize bounds, `includeDemo`
 * defaulting false) intentionally matches those existing parsers so the
 * convention stays consistent across the app even though the code is
 * separate.
 */

export const REPORT_DEFAULT_PAGE_SIZE = 50;
export const REPORT_MAX_PAGE_SIZE = 200;
const MAX_PAGE = 100000;

export type ParsedReportFilters = { ok: true; filters: ReportFilters } | { ok: false; message: string };
export type ParsedPagination = { ok: true; pagination: PaginationParams } | { ok: false; message: string };

function readInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function readDateOnly(value: string | null, fieldName: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!isValidDateOnlyString(trimmed)) {
    return { ok: false, message: `${fieldName} must be a valid YYYY-MM-DD date.` };
  }
  return { ok: true, value: trimmed };
}

function readOptionalString(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validates a status filter against a known set of enum values, rejecting
 * garbage input with a clear 400 instead of letting it reach Prisma as an
 * invalid enum literal (which would surface as an unhandled 500 from
 * whichever report route happens to run first). Used for orderStatus/
 * quotationStatus/claimStatus, each of which maps onto exactly one schema
 * enum, so central validation here is unambiguous.
 *
 * fulfilmentStatus and communicationStatus are NOT validated here -- see
 * this file's own comment on readOptionalString's two call sites for
 * those fields below: each one maps onto more than one schema enum
 * depending on which report is consuming it (PickingSessionStatus /
 * DispatchStatus / DeliveryOutcome for fulfilmentStatus; MessageIntakeStatus
 * / OutboundMessageStatus for communicationStatus), so there is no single
 * valid set to check here. Each report function that actually applies one
 * of these two filters validates it itself, against only the one enum
 * that field's own underlying table uses -- see lib/reporting/
 * management-reports.ts.
 */
function readEnumFilter(value: string | null, validValues: readonly string[], fieldName: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!validValues.includes(trimmed)) {
    return { ok: false, message: `${fieldName} must be one of: ${validValues.join(", ")}.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * The default reporting window when neither dateFrom nor dateTo is
 * supplied: the trailing 30 UTC calendar days including today. A
 * management-report function with its own fixed period (the daily/
 * weekly/monthly summaries in lib/reporting/management-reports.ts)
 * ignores dateFrom/dateTo entirely and computes its own period instead
 * -- see that file.
 */
export function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    dateFrom: utcDateToDateOnlyString(from)!,
    dateTo: utcDateToDateOnlyString(today)!,
  };
}

export function parseReportFilters(params: URLSearchParams): ParsedReportFilters {
  const dateFromResult = readDateOnly(params.get("dateFrom"), "dateFrom");
  if (!dateFromResult.ok) return dateFromResult;
  const dateToResult = readDateOnly(params.get("dateTo"), "dateTo");
  if (!dateToResult.ok) return dateToResult;

  if (dateFromResult.value && dateToResult.value && dateFromResult.value > dateToResult.value) {
    return { ok: false, message: "dateFrom must not be after dateTo." };
  }

  const orderStatusResult = readEnumFilter(params.get("orderStatus"), ORDER_STATUSES, "orderStatus");
  if (!orderStatusResult.ok) return orderStatusResult;
  const quotationStatusResult = readEnumFilter(params.get("quotationStatus"), Object.keys(QUOTATION_STATUS_LABELS), "quotationStatus");
  if (!quotationStatusResult.ok) return quotationStatusResult;
  const claimStatusResult = readEnumFilter(params.get("claimStatus"), Object.keys(CLAIM_STATUS_LABELS), "claimStatus");
  if (!claimStatusResult.ok) return claimStatusResult;
  // Milestone 12 (Sales Performance Intelligence). lostSalesReason maps
  // onto exactly one schema enum (LostSaleReason), so -- unlike
  // fulfilmentStatus/communicationStatus above -- it IS centrally
  // validated here, the same precedent orderStatus/quotationStatus/
  // claimStatus already set.
  const lostSalesReasonResult = readEnumFilter(params.get("lostSalesReason"), Object.keys(LOST_SALE_REASON_LABELS), "lostSalesReason");
  if (!lostSalesReasonResult.ok) return lostSalesReasonResult;

  const currencyRaw = (params.get("currency") ?? "").trim().toUpperCase();
  if (currencyRaw !== "" && !/^[A-Z]{3}$/.test(currencyRaw)) {
    return { ok: false, message: "currency must be a 3-letter code." };
  }

  // Milestone 14 (Product Intelligence). Three new, deliberately OPTIONAL
  // filters -- see ReportFilters' own comment in lib/reporting/types.ts
  // for why these are optional rather than required fields on that type.
  // productCategory is free text (Product.category has no controlled
  // taxonomy -- spec section 3), so, like currency, it is length-capped
  // rather than validated against a fixed enum. productSearch is a
  // free-text search term, also length-capped. sapItemCode is validated
  // only for length, never for a specific format -- this schema's own
  // SapInvoiceLine.sapItemCode/Product.sapItemCode comment documents SAP
  // item codes as opaque strings with no fixed shape this codebase can
  // assume.
  const MAX_FILTER_TEXT_LENGTH = 100;
  const productCategoryRaw = readOptionalString(params.get("productCategory"));
  if (productCategoryRaw && productCategoryRaw.length > MAX_FILTER_TEXT_LENGTH) {
    return { ok: false, message: `productCategory must be ${MAX_FILTER_TEXT_LENGTH} characters or fewer.` };
  }
  const productSearchRaw = readOptionalString(params.get("productSearch"));
  if (productSearchRaw && productSearchRaw.length > MAX_FILTER_TEXT_LENGTH) {
    return { ok: false, message: `productSearch must be ${MAX_FILTER_TEXT_LENGTH} characters or fewer.` };
  }
  const sapItemCodeRaw = readOptionalString(params.get("sapItemCode"));
  if (sapItemCodeRaw && sapItemCodeRaw.length > MAX_FILTER_TEXT_LENGTH) {
    return { ok: false, message: `sapItemCode must be ${MAX_FILTER_TEXT_LENGTH} characters or fewer.` };
  }

  return {
    ok: true,
    filters: {
      dateFrom: dateFromResult.value,
      dateTo: dateToResult.value,
      customerId: readOptionalString(params.get("customerId")),
      productId: readOptionalString(params.get("productId")),
      salespersonId: readOptionalString(params.get("salespersonId")),
      orderStatus: orderStatusResult.value,
      quotationStatus: quotationStatusResult.value,
      // Not centrally validated -- see readEnumFilter's own comment above.
      fulfilmentStatus: readOptionalString(params.get("fulfilmentStatus")),
      claimStatus: claimStatusResult.value,
      communicationStatus: readOptionalString(params.get("communicationStatus")),
      // Spec section 2: "demo data must remain excluded from operational
      // reporting by default" -- same `includeDemo=true` opt-in convention
      // every existing dashboard (invoice claims, quotations, lost sales,
      // invoice reconciliation, approvals) already uses.
      includeDemo: params.get("includeDemo") === "true",
      currency: currencyRaw === "" ? null : currencyRaw,
      lostSalesReason: lostSalesReasonResult.value,
      productCategory: productCategoryRaw,
      productSearch: productSearchRaw,
      sapItemCode: sapItemCodeRaw,
    },
  };
}

export function parsePagination(params: URLSearchParams): ParsedPagination {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);
  if (page === null) return { ok: false, message: "Invalid page number." };

  const pageSize = readInteger(params.get("pageSize"), REPORT_DEFAULT_PAGE_SIZE, 1, REPORT_MAX_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: `pageSize must be between 1 and ${REPORT_MAX_PAGE_SIZE}.` };
  }

  return { ok: true, pagination: { page, pageSize } };
}

/**
 * Converts a filters.dateFrom/dateTo pair (each an inclusive UTC
 * calendar day, or null) into a Prisma-ready range for a `@db.Timestamptz`
 * column: `gte` the start of dateFrom's day, `lt` the start of the day
 * AFTER dateTo -- never `lte` dateTo's own UTC-midnight instant, which
 * would silently exclude every timestamp recorded later that same day.
 * Returns `undefined` for a bound that's absent, so the caller can spread
 * this straight into a Prisma `where` clause and get no restriction on a
 * side that has no filter.
 */
export function dateRangeToTimestampFilter(filters: Pick<ReportFilters, "dateFrom" | "dateTo">): { gte?: Date; lt?: Date } {
  const result: { gte?: Date; lt?: Date } = {};
  if (filters.dateFrom) {
    result.gte = dateOnlyStringToUtcDate(filters.dateFrom)!;
  }
  if (filters.dateTo) {
    const endExclusive = dateOnlyStringToUtcDate(filters.dateTo)!;
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    result.lt = endExclusive;
  }
  return result;
}

/** Same as dateRangeToTimestampFilter, but for a `@db.Date` column (orderDate, quotationDate, claimDate, ...): inclusive on both ends, since a date-only column has no time-of-day to spill into the next day. */
export function dateRangeToDateOnlyFilter(filters: Pick<ReportFilters, "dateFrom" | "dateTo">): { gte?: Date; lte?: Date } {
  const result: { gte?: Date; lte?: Date } = {};
  if (filters.dateFrom) result.gte = dateOnlyStringToUtcDate(filters.dateFrom)!;
  if (filters.dateTo) result.lte = dateOnlyStringToUtcDate(filters.dateTo)!;
  return result;
}

/** `{ isDemo: false }` unless the filter set explicitly opted into demo rows -- spread into any Prisma `where`. */
export function demoWhere(filters: Pick<ReportFilters, "includeDemo">): { isDemo?: false } {
  return filters.includeDemo ? {} : { isDemo: false };
}

/**
 * Milestone 13 (Customer Intelligence). The "apply defaultDateRange()'s
 * 30-day fallback when dateFrom/dateTo are unset" step every M11/M12
 * report already repeats inline (see e.g. lib/reporting/
 * sales-revenue-queries.ts's own getSalesRevenueReport) -- pulled out
 * here as its own small, shared export purely so the several new M13
 * query modules that all need it (customer-revenue-queries.ts,
 * customer-purchasing-queries.ts, customer-commercial-health-queries.ts)
 * can import ONE function instead of each re-typing the same two-line
 * fallback, and so none of them need to import from one another just to
 * share it. Purely additive -- no existing call site is changed to use
 * this instead of its own inline version.
 */
export function resolveEffectiveDateRange(filters: Pick<ReportFilters, "dateFrom" | "dateTo">): { effectiveFrom: string; effectiveTo: string } {
  const { dateFrom, dateTo } = defaultDateRange();
  return {
    effectiveFrom: filters.dateFrom ?? dateFrom,
    effectiveTo: filters.dateTo ?? dateTo,
  };
}
