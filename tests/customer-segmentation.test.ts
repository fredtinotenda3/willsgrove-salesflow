import { describe, it, expect } from "vitest";
import { rankByValue } from "@/lib/reporting/customer-segmentation";

/**
 * Milestone 13 (Customer Intelligence). Unconditional unit tests for
 * lib/reporting/customer-segmentation.ts -- pure relative ranking (no
 * @prisma/client import), runnable in this sandbox without
 * RUN_DB_INTEGRATION_TESTS.
 */

describe("rankByValue", () => {
  it("ranks descending (rank 1 = highest value) for SAP invoice line value / purchase frequency", () => {
    const result = rankByValue(
      [
        { customerId: "c1", value: 50 },
        { customerId: "c2", value: 150 },
        { customerId: "c3", value: 100 },
      ],
      "descending"
    );
    expect(result.map((r) => r.customerId)).toEqual(["c2", "c3", "c1"]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("ranks ascending (rank 1 = lowest value) for days-since-last-qualifying-invoice -- most recent customer ranks first", () => {
    const result = rankByValue(
      [
        { customerId: "c1", value: 30 },
        { customerId: "c2", value: 2 },
        { customerId: "c3", value: 10 },
      ],
      "ascending"
    );
    expect(result.map((r) => r.customerId)).toEqual(["c2", "c3", "c1"]);
  });

  it("breaks ties deterministically by customerId, never by arbitrary input order", () => {
    const result = rankByValue(
      [
        { customerId: "z-customer", value: 100 },
        { customerId: "a-customer", value: 100 },
      ],
      "descending"
    );
    expect(result.map((r) => r.customerId)).toEqual(["a-customer", "z-customer"]);
  });

  it("never introduces a composite score -- each ranked row carries only its own single value, no blended field", () => {
    const result = rankByValue([{ customerId: "c1", value: 42 }], "descending");
    expect(Object.keys(result[0]).sort()).toEqual(["customerId", "rank", "value"]);
  });

  it("returns an empty array for no customers at all", () => {
    expect(rankByValue([], "descending")).toEqual([]);
  });
});
