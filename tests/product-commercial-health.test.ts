import { describe, it, expect } from "vitest";
import { resolveSingleProductSapItemCode } from "@/lib/reporting/product-commercial-health";

/**
 * Milestone 14 (Product Intelligence), spec sections 5.7/7. Unconditional
 * unit tests for lib/reporting/product-commercial-health.ts's pure claim
 * product-attribution rule -- no @prisma/client import, runnable in this
 * sandbox without RUN_DB_INTEGRATION_TESTS.
 */

describe("resolveSingleProductSapItemCode", () => {
  it("resolves to the single product when every line shares the same SAP item code", () => {
    expect(resolveSingleProductSapItemCode(["ITEM-1", "ITEM-1", "ITEM-1"])).toEqual({ kind: "single", sapItemCode: "ITEM-1" });
  });

  it("resolves to 'single' for just one line", () => {
    expect(resolveSingleProductSapItemCode(["ITEM-1"])).toEqual({ kind: "single", sapItemCode: "ITEM-1" });
  });

  it("is NOT attributed to any product when lines span two or more distinct item codes -- never guessed, never pro-rata split", () => {
    expect(resolveSingleProductSapItemCode(["ITEM-1", "ITEM-2"])).toEqual({ kind: "multiple" });
  });

  it("resolves to 'none' when every line's item code is missing", () => {
    expect(resolveSingleProductSapItemCode([null, undefined, ""])).toEqual({ kind: "none" });
    expect(resolveSingleProductSapItemCode([])).toEqual({ kind: "none" });
  });

  it("resolves to 'single' when one line has a real code and another has no code at all -- a missing code carries no conflicting information", () => {
    expect(resolveSingleProductSapItemCode(["ITEM-1", null, "", undefined])).toEqual({ kind: "single", sapItemCode: "ITEM-1" });
  });

  it("treats whitespace-only codes the same as missing codes", () => {
    expect(resolveSingleProductSapItemCode(["ITEM-1", "   "])).toEqual({ kind: "single", sapItemCode: "ITEM-1" });
  });

  it("trims surrounding whitespace before comparing codes for distinctness", () => {
    expect(resolveSingleProductSapItemCode(["ITEM-1", " ITEM-1 "])).toEqual({ kind: "single", sapItemCode: "ITEM-1" });
  });
});
