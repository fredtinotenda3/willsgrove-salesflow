import { describe, expect, it } from "vitest";
import { resolveEffectiveLostValue } from "@/lib/lost-sales/effective-value";
import { resolveRejectionReasonLabel, deriveLineReturnFacet } from "@/lib/invoice-claims/invoice-claim-state";

describe("resolveEffectiveLostValue", () => {
  it("prefers the stored estimate", () => {
    expect(
      resolveEffectiveLostValue({ storedUnitPrice: "3", storedValue: "30", lineApprovedUnitPrice: "2", lineCustomerUnitPrice: "2", quantity: "10" })
    ).toEqual({ unitPrice: "3", value: "30", source: "STORED" });
  });
  it("falls back to the order line price x lost quantity (10 KG x 2 = 20)", () => {
    expect(
      resolveEffectiveLostValue({ storedUnitPrice: null, storedValue: null, lineApprovedUnitPrice: null, lineCustomerUnitPrice: "2", quantity: "10" })
    ).toEqual({ unitPrice: "2", value: "20.0000", source: "ORDER_LINE_PRICE" });
  });
  it("uses the approved price over the customer price", () => {
    expect(
      resolveEffectiveLostValue({ storedUnitPrice: null, storedValue: null, lineApprovedUnitPrice: "2.5", lineCustomerUnitPrice: "2", quantity: "4" }).value
    ).toBe("10.0000");
  });
  it("keeps unpriced lines null, never zero", () => {
    expect(
      resolveEffectiveLostValue({ storedUnitPrice: null, storedValue: null, lineApprovedUnitPrice: null, lineCustomerUnitPrice: null, quantity: "10" })
    ).toEqual({ unitPrice: null, value: null, source: null });
  });
});

describe("returned product helpers", () => {
  const labels = { SHORT_DELIVERY: "Short Delivered" };
  it("maps identifiers to labels and keeps unknown text", () => {
    expect(resolveRejectionReasonLabel("SHORT_DELIVERY", labels)).toBe("Short Delivered");
    expect(resolveRejectionReasonLabel("Damaged in transit", labels)).toBe("Damaged in transit");
    expect(resolveRejectionReasonLabel("  ", labels)).toBeNull();
    expect(resolveRejectionReasonLabel(null, labels)).toBeNull();
  });
  it("derives partial / full / no return against the rejected quantity", () => {
    expect(deriveLineReturnFacet("0", "5")).toBe("NONE");
    expect(deriveLineReturnFacet("2", "5")).toBe("PARTIAL_RETURN");
    expect(deriveLineReturnFacet("5", "5")).toBe("FULL_RETURN");
  });
});
