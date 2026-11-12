import { describe, it, expect } from "vitest";
import {
  parseReportFilters,
  parsePagination,
  defaultDateRange,
  dateRangeToTimestampFilter,
  dateRangeToDateOnlyFilter,
  demoWhere,
  REPORT_DEFAULT_PAGE_SIZE,
  REPORT_MAX_PAGE_SIZE,
} from "@/lib/reporting/filters";

/**
 * Milestone 11 (Operational BI). Unconditional unit tests for
 * lib/reporting/filters.ts -- the one lib/reporting/*.ts file with no
 * @prisma/client dependency anywhere in its import graph (it imports only
 * lib/dates.ts, lib/order-display.ts, lib/quotations/display.ts and
 * lib/invoice-claims/display.ts, none of which touch Prisma), so unlike
 * every other lib/reporting/* file it can run here without
 * RUN_DB_INTEGRATION_TESTS -- same reasoning as tests/picking-validation.test.ts
 * and tests/fulfilment-decimal.test.ts.
 *
 * This is deliberately where the heaviest coverage of this round's
 * architecture fix lives: parseReportFilters is the ONE place
 * orderStatus/quotationStatus/claimStatus are validated centrally, and a
 * garbage value here must become a clean 400-shaped error for every
 * report route, not an unhandled 500 once it reaches Prisma.
 */

describe("parseReportFilters", () => {
  function params(query: Record<string, string>): URLSearchParams {
    return new URLSearchParams(query);
  }

  it("parses a full, valid filter set", () => {
    const result = parseReportFilters(
      params({
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        customerId: "cust_1",
        productId: "prod_1",
        salespersonId: "user_1",
        orderStatus: "APPROVED",
        quotationStatus: "ACCEPTED",
        fulfilmentStatus: "AUTHORIZED",
        claimStatus: "OPEN",
        communicationStatus: "FAILED",
        includeDemo: "true",
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      customerId: "cust_1",
      productId: "prod_1",
      salespersonId: "user_1",
      orderStatus: "APPROVED",
      quotationStatus: "ACCEPTED",
      fulfilmentStatus: "AUTHORIZED",
      claimStatus: "OPEN",
      communicationStatus: "FAILED",
      includeDemo: true,
    });
  });

  it("defaults includeDemo to false when absent, and treats anything other than the literal string \"true\" as false", () => {
    const absent = parseReportFilters(params({}));
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.filters.includeDemo).toBe(false);

    const withGarbage = parseReportFilters(params({ includeDemo: "1" }));
    expect(withGarbage.ok).toBe(true);
    if (withGarbage.ok) expect(withGarbage.filters.includeDemo).toBe(false);
  });

  it("every absent optional filter becomes null, never undefined or an empty string", () => {
    const result = parseReportFilters(params({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.dateFrom).toBeNull();
    expect(result.filters.customerId).toBeNull();
    expect(result.filters.orderStatus).toBeNull();
    expect(result.filters.fulfilmentStatus).toBeNull();
    expect(result.filters.communicationStatus).toBeNull();
  });

  it("trims whitespace-only values down to null", () => {
    const result = parseReportFilters(params({ customerId: "   ", fulfilmentStatus: "  " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.customerId).toBeNull();
    expect(result.filters.fulfilmentStatus).toBeNull();
  });

  it("rejects a malformed dateFrom/dateTo with a clear message, never silently coercing it", () => {
    const result = parseReportFilters(params({ dateFrom: "01/01/2026" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/dateFrom/);
  });

  it("rejects dateFrom after dateTo", () => {
    const result = parseReportFilters(params({ dateFrom: "2026-02-01", dateTo: "2026-01-01" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/dateFrom must not be after dateTo/);
  });

  it("accepts dateFrom equal to dateTo (a single-day range)", () => {
    const result = parseReportFilters(params({ dateFrom: "2026-01-15", dateTo: "2026-01-15" }));
    expect(result.ok).toBe(true);
  });

  it("rejects an orderStatus value outside the OrderStatus enum, this milestone's own centrally-validated status filter", () => {
    const result = parseReportFilters(params({ orderStatus: "NOT_A_REAL_STATUS" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/orderStatus must be one of/);
  });

  it("rejects an invalid quotationStatus and an invalid claimStatus the same way", () => {
    const badQuotation = parseReportFilters(params({ quotationStatus: "BOGUS" }));
    expect(badQuotation.ok).toBe(false);
    const badClaim = parseReportFilters(params({ claimStatus: "BOGUS" }));
    expect(badClaim.ok).toBe(false);
  });

  it("passes fulfilmentStatus and communicationStatus through unvalidated -- each maps onto more than one schema enum depending on which report consumes it, so there is deliberately no single valid set to check here", () => {
    // A value that is well-formed for ONE possible underlying enum
    // (DeliveryOutcome) must pass this central parser even though it
    // would be meaningless for a different report (PickingSessionStatus)
    // -- lib/reporting/management-reports.ts's own applicableEnumFilter
    // is where each report decides relevance, not this shared parser.
    const result = parseReportFilters(params({ fulfilmentStatus: "ACCEPTED_IN_FULL", communicationStatus: "ANYTHING_AT_ALL" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.fulfilmentStatus).toBe("ACCEPTED_IN_FULL");
    expect(result.filters.communicationStatus).toBe("ANYTHING_AT_ALL");
  });
});

describe("parsePagination", () => {
  function params(query: Record<string, string>): URLSearchParams {
    return new URLSearchParams(query);
  }

  it("defaults to page 1 and the default page size when absent", () => {
    const result = parsePagination(params({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pagination).toEqual({ page: 1, pageSize: REPORT_DEFAULT_PAGE_SIZE });
  });

  it("accepts an explicit page and pageSize within bounds", () => {
    const result = parsePagination(params({ page: "3", pageSize: "25" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pagination).toEqual({ page: 3, pageSize: 25 });
  });

  it("rejects a pageSize above REPORT_MAX_PAGE_SIZE rather than silently clamping it", () => {
    const result = parsePagination(params({ pageSize: String(REPORT_MAX_PAGE_SIZE + 1) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(new RegExp(String(REPORT_MAX_PAGE_SIZE)));
  });

  it("accepts pageSize exactly at REPORT_MAX_PAGE_SIZE", () => {
    const result = parsePagination(params({ pageSize: String(REPORT_MAX_PAGE_SIZE) }));
    expect(result.ok).toBe(true);
  });

  it("rejects a zero, negative, or non-numeric page", () => {
    expect(parsePagination(params({ page: "0" })).ok).toBe(false);
    expect(parsePagination(params({ page: "-1" })).ok).toBe(false);
    expect(parsePagination(params({ page: "abc" })).ok).toBe(false);
  });
});

describe("defaultDateRange", () => {
  it("returns a 30-UTC-calendar-day inclusive window ending today", () => {
    const { dateFrom, dateTo } = defaultDateRange();
    const from = new Date(`${dateFrom}T00:00:00.000Z`);
    const to = new Date(`${dateTo}T00:00:00.000Z`);
    const diffDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(29); // 30 inclusive days spans a 29-day difference
    const today = new Date();
    expect(dateTo).toBe(today.toISOString().slice(0, 10));
  });
});

describe("dateRangeToTimestampFilter", () => {
  it("gte is the start of dateFrom's UTC day, and lt is the start of the day AFTER dateTo -- never dateTo's own midnight", () => {
    const result = dateRangeToTimestampFilter({ dateFrom: "2026-03-10", dateTo: "2026-03-12" });
    expect(result.gte?.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    // Exclusive upper bound one full day past dateTo -- so a timestamp
    // recorded at 23:59 on dateTo itself is still included.
    expect(result.lt?.toISOString()).toBe("2026-03-13T00:00:00.000Z");
  });

  it("returns an empty object for a side with no bound, so spreading it imposes no restriction", () => {
    expect(dateRangeToTimestampFilter({ dateFrom: null, dateTo: null })).toEqual({});
    expect(dateRangeToTimestampFilter({ dateFrom: "2026-01-01", dateTo: null })).toEqual({ gte: new Date("2026-01-01T00:00:00.000Z") });
  });
});

describe("dateRangeToDateOnlyFilter", () => {
  it("is inclusive on both ends for a @db.Date column, unlike the timestamp variant", () => {
    const result = dateRangeToDateOnlyFilter({ dateFrom: "2026-03-10", dateTo: "2026-03-12" });
    expect(result.gte?.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(result.lte?.toISOString()).toBe("2026-03-12T00:00:00.000Z");
  });
});

describe("demoWhere", () => {
  it("excludes demo rows by default (includeDemo: false)", () => {
    expect(demoWhere({ includeDemo: false })).toEqual({ isDemo: false });
  });

  it("imposes no restriction when includeDemo is true", () => {
    expect(demoWhere({ includeDemo: true })).toEqual({});
  });
});
