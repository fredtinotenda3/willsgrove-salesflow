import { describe, it, expect } from "vitest";
import { classifyCustomerPeriodActivity } from "@/lib/reporting/customer-activity";

/**
 * Milestone 12 (Sales Performance Intelligence). Unconditional unit
 * tests for lib/reporting/customer-activity.ts -- the pure half of the
 * new/repeat customer classifier (no @prisma/client import; see that
 * module's own top comment), runnable in this sandbox without
 * RUN_DB_INTEGRATION_TESTS.
 *
 * Per that module's own precondition comment, every call here assumes
 * the customer already has >=1 qualifying invoice inside the period --
 * the "NEITHER" (no qualifying invoice in period at all) case is a
 * property of lib/reporting/customer-activity-queries.ts's own
 * two-step query (a customer never reaching this function at all), not
 * something this pure function can itself return, so it's covered by
 * that file's own DB-integration coverage, not here.
 */
describe("classifyCustomerPeriodActivity", () => {
  const periodFrom = new Date("2026-02-01T00:00:00.000Z");
  const periodTo = new Date("2026-02-28T00:00:00.000Z");

  it("NEW: the customer's all-time-first qualifying invoice falls inside the period", () => {
    expect(classifyCustomerPeriodActivity(new Date("2026-02-15T00:00:00.000Z"), periodFrom, periodTo)).toBe("NEW");
  });

  it("NEW: first invoice lands exactly on the period's start boundary (inclusive)", () => {
    expect(classifyCustomerPeriodActivity(periodFrom, periodFrom, periodTo)).toBe("NEW");
  });

  it("NEW: first invoice lands exactly on the period's end boundary (inclusive)", () => {
    expect(classifyCustomerPeriodActivity(periodTo, periodFrom, periodTo)).toBe("NEW");
  });

  it("REPEAT: first-ever qualifying invoice is strictly before the period, but the customer has another qualifying invoice inside it (guaranteed by the caller's own precondition)", () => {
    expect(classifyCustomerPeriodActivity(new Date("2026-01-10T00:00:00.000Z"), periodFrom, periodTo)).toBe("REPEAT");
  });

  it("REPEAT: first-ever qualifying invoice is exactly one day before the period's start boundary", () => {
    expect(classifyCustomerPeriodActivity(new Date("2026-01-31T00:00:00.000Z"), periodFrom, periodTo)).toBe("REPEAT");
  });

  it("a single-day period (dateFrom === dateTo) still classifies correctly", () => {
    const singleDay = new Date("2026-02-15T00:00:00.000Z");
    expect(classifyCustomerPeriodActivity(singleDay, singleDay, singleDay)).toBe("NEW");
    expect(classifyCustomerPeriodActivity(new Date("2026-02-14T00:00:00.000Z"), singleDay, singleDay)).toBe("REPEAT");
  });
});
