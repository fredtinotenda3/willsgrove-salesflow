import { describe, it, expect } from "vitest";
import { isValidDateOnlyString, dateOnlyStringToUtcDate, utcDateToDateOnlyString } from "@/lib/dates";

// Milestone 0 fix (round 5): this is the unconditional, sandbox-safe half
// of this round's test coverage for the orderDate/requestedDeliveryDate
// bug (see CHANGES.md's round-5 section). It exercises the conversion
// logic directly -- no Prisma import, no database -- against the exact
// string from your bug report ("2026-11-09") plus the edge cases that
// matter for a date-only value: invalid shapes, calendar days that don't
// exist, leap years, and round-tripping. The real-database half of this
// round's test coverage is tests/orders-db.integration.test.ts, which is
// opt-in rather than unconditional -- see that file's header comment for
// why, and CHANGES.md for the short manual check as a fallback.

describe("isValidDateOnlyString", () => {
  it("accepts the exact date from the round-5 bug report", () => {
    expect(isValidDateOnlyString("2026-11-09")).toBe(true);
  });

  it("accepts a valid leap-day date (2028 is a leap year)", () => {
    expect(isValidDateOnlyString("2028-02-29")).toBe(true);
  });

  it("rejects 2026-02-29 (2026 is not a leap year)", () => {
    expect(isValidDateOnlyString("2026-02-29")).toBe(false);
  });

  it("rejects 2026-02-30 (February never has 30 days)", () => {
    // The actual case Number.isNaN(...) alone would miss: JS's Date
    // constructor silently rolls this forward to 2 March instead of
    // producing an invalid date.
    expect(isValidDateOnlyString("2026-02-30")).toBe(false);
  });

  it("rejects 2026-04-31 (April has 30 days)", () => {
    expect(isValidDateOnlyString("2026-04-31")).toBe(false);
  });

  it("rejects a string with a time component", () => {
    expect(isValidDateOnlyString("2026-11-09T00:00:00.000Z")).toBe(false);
  });

  it("rejects a slash-separated date", () => {
    expect(isValidDateOnlyString("2026/11/09")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidDateOnlyString("")).toBe(false);
  });

  it("rejects month 13", () => {
    expect(isValidDateOnlyString("2026-13-01")).toBe(false);
  });

  it("rejects day 00", () => {
    expect(isValidDateOnlyString("2026-11-00")).toBe(false);
  });

  it("accepts the first and last days of a year", () => {
    expect(isValidDateOnlyString("2026-01-01")).toBe(true);
    expect(isValidDateOnlyString("2026-12-31")).toBe(true);
  });
});

describe("dateOnlyStringToUtcDate", () => {
  it("converts the exact date from the round-5 bug report to UTC midnight", () => {
    const date = dateOnlyStringToUtcDate("2026-11-09");
    expect(date).not.toBeNull();
    // This is the actual fix: the stored value must be a full ISO-8601
    // *datetime* string (with a time component), which is what Prisma's
    // DateTime parser requires -- a bare "2026-11-09" is exactly what
    // produced "premature end of input. Expected ISO-8601 DateTime." in
    // the bug report.
    expect(date?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("returns null for null", () => {
    expect(dateOnlyStringToUtcDate(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(dateOnlyStringToUtcDate(undefined)).toBeNull();
  });

  it("throws for an invalid calendar date rather than silently storing the wrong day", () => {
    expect(() => dateOnlyStringToUtcDate("2026-02-30")).toThrow();
  });

  it("throws for a malformed string", () => {
    expect(() => dateOnlyStringToUtcDate("not-a-date")).toThrow();
  });

  it("handles a leap-day date correctly", () => {
    const date = dateOnlyStringToUtcDate("2028-02-29");
    expect(date?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("handles the last day of the year correctly (no month/year rollover)", () => {
    const date = dateOnlyStringToUtcDate("2026-12-31");
    expect(date?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("utcDateToDateOnlyString", () => {
  it("is the exact inverse of dateOnlyStringToUtcDate for the round-5 bug report's dates", () => {
    for (const value of ["2026-11-09", "2026-11-12", "2028-02-29", "2026-01-01", "2026-12-31"]) {
      const date = dateOnlyStringToUtcDate(value);
      expect(utcDateToDateOnlyString(date)).toBe(value);
    }
  });

  it("returns null for null", () => {
    expect(utcDateToDateOnlyString(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(utcDateToDateOnlyString(undefined)).toBeNull();
  });
});
