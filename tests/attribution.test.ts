import { describe, it, expect } from "vitest";
import {
  readSalespersonAssignment,
  classifyDirectOrderAttribution,
  classifyQuotationSourcedAttribution,
  classifyOrderAttribution,
  ATTRIBUTION_BUCKETS,
  ATTRIBUTION_BUCKET_LABELS,
  ATTRIBUTION_BUCKET_DEFINITIONS,
  type DirectOrderAttributionInput,
} from "@/lib/reporting/attribution";

/**
 * Milestone 12 (Sales Performance Intelligence). Unconditional unit
 * tests for lib/reporting/attribution.ts -- the pure half of the
 * salesperson-attribution-confidence classifier, with no
 * @prisma/client import anywhere in its graph (see that module's own
 * top comment for why), so this file runs in this sandbox without
 * RUN_DB_INTEGRATION_TESTS, same reasoning as tests/fulfilment-decimal
 * .test.ts and tests/picking-validation.test.ts.
 */

describe("readSalespersonAssignment", () => {
  it("returns null for afterData with no salespersonAssignment sub-object at all -- every pre-fix audit row, by construction", () => {
    expect(readSalespersonAssignment(null)).toBeNull();
    expect(readSalespersonAssignment(undefined)).toBeNull();
    expect(readSalespersonAssignment({})).toBeNull();
    expect(readSalespersonAssignment({ salespersonId: "u1" })).toBeNull(); // the bare field, not the sub-object
    expect(readSalespersonAssignment("not an object")).toBeNull();
    expect(readSalespersonAssignment(42)).toBeNull();
  });

  it("parses a well-formed explicit assignment", () => {
    const result = readSalespersonAssignment({ salespersonAssignment: { salespersonId: "sp1", source: "explicit", assignedById: "mgr1" } });
    expect(result).toEqual({ salespersonId: "sp1", source: "explicit", assignedById: "mgr1" });
  });

  it("parses a well-formed unassigned assignment, with salespersonId: null", () => {
    const result = readSalespersonAssignment({ salespersonAssignment: { salespersonId: null, source: "unassigned", assignedById: "mgr1" } });
    expect(result).toEqual({ salespersonId: null, source: "unassigned", assignedById: "mgr1" });
  });

  it("is defensive against a malformed sub-object -- an invalid source, a missing assignedById, or a non-string/non-null salespersonId -- returning null rather than throwing", () => {
    expect(readSalespersonAssignment({ salespersonAssignment: { salespersonId: "sp1", source: "bogus", assignedById: "mgr1" } })).toBeNull();
    expect(readSalespersonAssignment({ salespersonAssignment: { salespersonId: "sp1", source: "explicit" } })).toBeNull();
    expect(readSalespersonAssignment({ salespersonAssignment: { salespersonId: "sp1", source: "explicit", assignedById: "" } })).toBeNull();
    expect(readSalespersonAssignment({ salespersonAssignment: { salespersonId: 42, source: "explicit", assignedById: "mgr1" } })).toBeNull();
    expect(readSalespersonAssignment({ salespersonAssignment: { salespersonId: "", source: "explicit", assignedById: "mgr1" } })).toBeNull();
    expect(readSalespersonAssignment({ salespersonAssignment: "not an object" })).toBeNull();
    expect(readSalespersonAssignment({ salespersonAssignment: null })).toBeNull();
  });
});

describe("classifyDirectOrderAttribution", () => {
  const baseOrder: DirectOrderAttributionInput = { salespersonId: "sp1", createdById: "sp1", createdByRole: "SALESPERSON" };

  it("salespersonId null -> UNASSIGNED, regardless of afterData", () => {
    expect(classifyDirectOrderAttribution({ ...baseOrder, salespersonId: null }, { salespersonAssignment: { salespersonId: "sp1", source: "explicit", assignedById: "mgr1" } })).toBe(
      "UNASSIGNED"
    );
  });

  it("an audit-confirmed explicit pick -> VERIFIED, even when salespersonId === createdById (a salesperson explicitly confirming their own order is still a real, recorded choice)", () => {
    expect(classifyDirectOrderAttribution(baseOrder, { salespersonAssignment: { salespersonId: "sp1", source: "explicit", assignedById: "sp1" } })).toBe("VERIFIED");
  });

  it("an audit-confirmed unassigned record -> UNASSIGNED (defensive path)", () => {
    expect(classifyDirectOrderAttribution(baseOrder, { salespersonAssignment: { salespersonId: null, source: "unassigned", assignedById: "sp1" } })).toBe("UNASSIGNED");
  });

  it("no provenance, salespersonId === createdById, creator was SALESPERSON -> UNVERIFIED_LIKELY", () => {
    expect(classifyDirectOrderAttribution(baseOrder, null)).toBe("UNVERIFIED_LIKELY");
  });

  it("no provenance, salespersonId === createdById, creator was SALES_MANAGER -> UNVERIFIED_SUSPECT", () => {
    expect(classifyDirectOrderAttribution({ ...baseOrder, createdByRole: "SALES_MANAGER" }, null)).toBe("UNVERIFIED_SUSPECT");
  });

  it("no provenance, salespersonId === createdById, creator was ADMINISTRATOR -> UNVERIFIED_SUSPECT", () => {
    expect(classifyDirectOrderAttribution({ ...baseOrder, createdByRole: "ADMINISTRATOR" }, null)).toBe("UNVERIFIED_SUSPECT");
  });

  it("no provenance, salespersonId differs from createdById -> UNVERIFIED_NO_PROVENANCE, never assumed reliable just because it differs", () => {
    expect(classifyDirectOrderAttribution({ ...baseOrder, salespersonId: "sp2" }, null)).toBe("UNVERIFIED_NO_PROVENANCE");
  });

  it("a malformed/unreadable afterData value falls back to the no-provenance path, exactly like null", () => {
    expect(classifyDirectOrderAttribution(baseOrder, "garbage")).toBe("UNVERIFIED_LIKELY");
    expect(classifyDirectOrderAttribution({ ...baseOrder, salespersonId: "sp2" }, "garbage")).toBe("UNVERIFIED_NO_PROVENANCE");
  });
});

describe("classifyQuotationSourcedAttribution", () => {
  it("an audit-confirmed explicit quotation -> VERIFIED", () => {
    expect(classifyQuotationSourcedAttribution({ salespersonAssignment: { salespersonId: "sp1", source: "explicit", assignedById: "sp1" } })).toBe("VERIFIED");
  });

  it("no provenance at all (pre-fix quotation) -> QUOTATION_SOURCED_LEGACY, never UNASSIGNED (Quotation.salespersonId is a required field)", () => {
    expect(classifyQuotationSourcedAttribution(null)).toBe("QUOTATION_SOURCED_LEGACY");
    expect(classifyQuotationSourcedAttribution(undefined)).toBe("QUOTATION_SOURCED_LEGACY");
  });

  it("an audit-confirmed UNASSIGNED quotation assignment is defensively treated as legacy, not VERIFIED (a quotation's salespersonId can never genuinely be unassigned)", () => {
    expect(classifyQuotationSourcedAttribution({ salespersonAssignment: { salespersonId: null, source: "unassigned", assignedById: "mgr1" } })).toBe("QUOTATION_SOURCED_LEGACY");
  });
});

describe("classifyOrderAttribution (the top-level router)", () => {
  it("routes a QUOTATION-sourced order to the quotation classifier, never reading the order's OWN ORDER_CREATE event (which always looks explicit for a converted order)", () => {
    const order = { salespersonId: "sp1", createdById: "mgr1", createdByRole: "SALES_MANAGER" as const, source: "QUOTATION" };
    const result = classifyOrderAttribution(order, {
      orderCreateAfterData: { salespersonAssignment: { salespersonId: "sp1", source: "explicit", assignedById: "mgr1" } }, // would read as VERIFIED if mistakenly consulted
      quotationCreatedAfterData: null, // the SOURCE quotation itself has no provenance
    });
    expect(result).toBe("QUOTATION_SOURCED_LEGACY");
  });

  it("routes a non-QUOTATION order to the direct classifier", () => {
    const order = { salespersonId: "sp1", createdById: "sp1", createdByRole: "SALESPERSON" as const, source: "EMAIL" };
    expect(classifyOrderAttribution(order, { orderCreateAfterData: null })).toBe("UNVERIFIED_LIKELY");
  });

  it("a null salespersonId always short-circuits to UNASSIGNED, even for a QUOTATION-sourced order (defensive -- should never happen given the schema)", () => {
    const order = { salespersonId: null, createdById: "mgr1", createdByRole: "SALES_MANAGER" as const, source: "QUOTATION" };
    expect(classifyOrderAttribution(order, { orderCreateAfterData: null, quotationCreatedAfterData: { salespersonAssignment: { salespersonId: "sp1", source: "explicit", assignedById: "mgr1" } } })).toBe(
      "UNASSIGNED"
    );
  });
});

describe("ATTRIBUTION_BUCKETS / labels / definitions -- internal consistency", () => {
  it("every bucket has exactly one label and one definition, and the two lists agree", () => {
    for (const bucket of ATTRIBUTION_BUCKETS) {
      expect(ATTRIBUTION_BUCKET_LABELS[bucket]).toBeTruthy();
      expect(ATTRIBUTION_BUCKET_DEFINITIONS[bucket]).toBeTruthy();
    }
    expect(Object.keys(ATTRIBUTION_BUCKET_LABELS).sort()).toEqual([...ATTRIBUTION_BUCKETS].sort());
    expect(Object.keys(ATTRIBUTION_BUCKET_DEFINITIONS).sort()).toEqual([...ATTRIBUTION_BUCKETS].sort());
  });
});
