import { describe, it, expect } from "vitest";
import { rankByValue, computePreviousPeriod } from "@/lib/reporting/product-segmentation";

/**
 * Milestone 14 (Product Intelligence). Unconditional unit tests for
 * lib/reporting/product-segmentation.ts -- pure relative ranking and
 * pure period-comparison date arithmetic (no @prisma/client import),
 * runnable in this sandbox without RUN_DB_INTEGRATION_TESTS.
 */

describe("rankByValue", () => {
  it("ranks descending (rank 1 = highest value) for SAP invoice line value / quantity / frequency / distinct customers", () => {
    const result = rankByValue(
      [
        { sapItemCode: "P1", value: 50 },
        { sapItemCode: "P2", value: 150 },
        { sapItemCode: "P3", value: 100 },
      ],
      "descending"
    );
    expect(result.map((r) => r.sapItemCode)).toEqual(["P2", "P3", "P1"]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("ranks ascending (rank 1 = lowest value) when direction is ascending", () => {
    const result = rankByValue(
      [
        { sapItemCode: "P1", value: 30 },
        { sapItemCode: "P2", value: 2 },
        { sapItemCode: "P3", value: 10 },
      ],
      "ascending"
    );
    expect(result.map((r) => r.sapItemCode)).toEqual(["P2", "P3", "P1"]);
  });

  it("breaks ties deterministically by sapItemCode, never by arbitrary input order", () => {
    const result = rankByValue(
      [
        { sapItemCode: "Z-ITEM", value: 100 },
        { sapItemCode: "A-ITEM", value: 100 },
      ],
      "descending"
    );
    expect(result.map((r) => r.sapItemCode)).toEqual(["A-ITEM", "Z-ITEM"]);
  });

  it("never introduces a composite score -- each ranked row carries only its own single value, no blended field", () => {
    const result = rankByValue([{ sapItemCode: "P1", value: 42 }], "descending");
    expect(Object.keys(result[0]).sort()).toEqual(["rank", "sapItemCode", "value"]);
  });

  it("returns an empty array for no products at all", () => {
    expect(rankByValue([], "descending")).toEqual([]);
  });
});

describe("computePreviousPeriod", () => {
  it("computes the immediately preceding period of EQUAL DURATION, with no gap and no overlap", () => {
    // Current period: Feb 1 - Feb 10 (10 days inclusive).
    const result = computePreviousPeriod("2026-02-01", "2026-02-10");
    expect(result).toEqual({ previousFrom: "2026-01-22", previousTo: "2026-01-31" });
  });

  it("handles a single-day current period correctly (duration of 1 day)", () => {
    const result = computePreviousPeriod("2026-02-01", "2026-02-01");
    expect(result).toEqual({ previousFrom: "2026-01-31", previousTo: "2026-01-31" });
  });

  it("crosses a year boundary correctly", () => {
    // Current period: Jan 1 - Jan 5 2026 (5 days inclusive).
    const result = computePreviousPeriod("2026-01-01", "2026-01-05");
    expect(result).toEqual({ previousFrom: "2025-12-27", previousTo: "2025-12-31" });
  });

  it("returns null (never throws) for an invalid date-only string", () => {
    expect(computePreviousPeriod("not-a-date", "2026-02-10")).toBeNull();
    expect(computePreviousPeriod("2026-02-01", "not-a-date")).toBeNull();
    expect(computePreviousPeriod("", "")).toBeNull();
  });

  it("returns null (never throws) when dateFrom is after dateTo", () => {
    expect(computePreviousPeriod("2026-02-10", "2026-02-01")).toBeNull();
  });
});
