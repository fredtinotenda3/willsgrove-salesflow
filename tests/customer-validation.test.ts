import { describe, it, expect } from "vitest";
import { validateUpdateCustomer } from "@/lib/customer-validation";

/**
 * Real Business Data Onboarding round (spec PART A, Phase 4b): the
 * priceListId branch validateUpdateCustomer gained so staff can assign/
 * unassign a customer's price list from the new Customer Pricing page
 * (app/price-lists/customers/page.tsx). Existence of the referenced
 * PriceList is checked at the database layer (lib/customers.ts's
 * updateCustomer, via the foreign-key constraint) -- this only covers the
 * shape-level rules this pure function itself enforces.
 */
describe("validateUpdateCustomer priceListId handling", () => {
  it("accepts a non-empty string and trims it", () => {
    const result = validateUpdateCustomer({ priceListId: "  clxyz123  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.priceListId).toBe("clxyz123");
    }
  });

  it("accepts null as an explicit unassign", () => {
    const result = validateUpdateCustomer({ priceListId: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.priceListId).toBeNull();
    }
  });

  it("leaves priceListId untouched when not provided at all", () => {
    const result = validateUpdateCustomer({ name: "Acme Ltd" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("priceListId" in result.value).toBe(false);
    }
  });

  it("rejects an empty string (ambiguous with unassign -- must use null)", () => {
    const result = validateUpdateCustomer({ priceListId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.priceListId).toBeDefined();
    }
  });

  it("rejects a non-string, non-null value", () => {
    const result = validateUpdateCustomer({ priceListId: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.priceListId).toBeDefined();
    }
  });

  it("combines with other fields in one update", () => {
    const result = validateUpdateCustomer({ name: "Acme Ltd", priceListId: "list-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ name: "Acme Ltd", priceListId: "list-1" });
    }
  });
});
