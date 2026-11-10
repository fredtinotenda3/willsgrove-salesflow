import { describe, it, expect } from "vitest";
import { resolveAssemblyFormLine } from "@/lib/assembly-form/resolve-line";

/**
 * Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
 * Unit tests for lib/assembly-form/resolve-line.ts's pure three-way
 * fallback -- unconditional (no @prisma/client dependency anywhere in
 * this file's or resolve-line.ts's import graph), same convention as
 * tests/picking-validation.test.ts and tests/handover-format-rows.test.ts.
 */

const BASE = {
  lineNumber: 1,
  originalProductDescription: "10 Inch Chocolate Cake (customer's own words)",
  sapItemCodeSnapshot: null as string | null,
  requestedQuantity: "10.0000",
  requestedUnitCode: "EA",
  productSapItemCode: null as string | null,
  officialProductDescription: null as string | null,
};

describe("resolveAssemblyFormLine", () => {
  it("prefers the live product match when one exists", () => {
    const resolved = resolveAssemblyFormLine({
      ...BASE,
      sapItemCodeSnapshot: "STALE-CODE",
      productSapItemCode: "CAKE-CHOC-10",
      officialProductDescription: "Chocolate Cake 10 Inch",
    });
    expect(resolved.sapItemCode).toBe("CAKE-CHOC-10");
    expect(resolved.description).toBe("Chocolate Cake 10 Inch");
  });

  it("falls back to the order-time SAP code snapshot when the product has since been removed from the catalogue", () => {
    const resolved = resolveAssemblyFormLine({
      ...BASE,
      sapItemCodeSnapshot: "CAKE-CHOC-10",
      productSapItemCode: null,
      officialProductDescription: null,
    });
    expect(resolved.sapItemCode).toBe("CAKE-CHOC-10");
    // No live product means no official description either -- falls
    // back to the customer's own wording rather than showing blank.
    expect(resolved.description).toBe(BASE.originalProductDescription);
  });

  it("falls back to the customer's own wording when there is no SAP match at all", () => {
    const resolved = resolveAssemblyFormLine({ ...BASE });
    expect(resolved.sapItemCode).toBeNull();
    expect(resolved.description).toBe(BASE.originalProductDescription);
  });

  it("carries lineNumber/requestedQuantity/requestedUnitCode through unchanged", () => {
    const resolved = resolveAssemblyFormLine({ ...BASE, lineNumber: 4, requestedQuantity: "7.5000", requestedUnitCode: "KG" });
    expect(resolved.lineNumber).toBe(4);
    expect(resolved.requestedQuantity).toBe("7.5000");
    expect(resolved.requestedUnitCode).toBe("KG");
  });
});
