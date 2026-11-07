import { describe, it, expect } from "vitest";
import { createOrderSchema, orderLineInputSchema } from "@/lib/order-validation";

// NOTE: this file imports `OrderSource` from `@prisma/client` as a runtime
// value (for `z.nativeEnum(OrderSource)`). In the build sandbox used to
// develop this milestone, `@prisma/client` is only a stub (the real client
// could never be generated there -- see PROGRESS.md) and does not export
// schema-derived enums at all, so this file fails to even import there.
// On a real machine, once `prisma generate` has run, it imports and runs
// normally -- confirmed: this is the behavior these tests describe.

describe("createOrderSchema", () => {
  it("validates a well-formed order payload", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      customerLocationId: "loc_123",
      source: "WHATSAPP",
      lines: [
        {
          originalProductDescription: "Apples G/D Econ 1.5kg",
          productId: "prod_123",
          requestedQuantity: "10",
          requestedUnitCode: "EA",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with no productId match and no optional fields", () => {
    // originalProductDescription is preserved verbatim from the customer's
    // PO even when it doesn't match a known product -- productId is a
    // best-effort link, not a requirement.
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "EMAIL",
      lines: [
        {
          originalProductDescription: "something handwritten on the PO",
          requestedQuantity: "3.5",
          requestedUnitCode: "KG",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an order source outside EMAIL/WHATSAPP/MANUAL", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "SMS",
      lines: [
        {
          originalProductDescription: "x",
          requestedQuantity: "1",
          requestedUnitCode: "EA",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with zero order lines", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "MANUAL",
      lines: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing customerId", () => {
    const result = createOrderSchema.safeParse({
      source: "MANUAL",
      lines: [
        {
          originalProductDescription: "x",
          requestedQuantity: "1",
          requestedUnitCode: "EA",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("orderLineInputSchema", () => {
  it("rejects a negative quantity", () => {
    const result = orderLineInputSchema.safeParse({
      originalProductDescription: "x",
      requestedQuantity: "-5",
      requestedUnitCode: "EA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero quantity", () => {
    const result = orderLineInputSchema.safeParse({
      originalProductDescription: "x",
      requestedQuantity: "0",
      requestedUnitCode: "EA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-decimal quantity string", () => {
    const result = orderLineInputSchema.safeParse({
      originalProductDescription: "x",
      requestedQuantity: "ten",
      requestedUnitCode: "EA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a quantity with more than 4 decimal places", () => {
    const result = orderLineInputSchema.safeParse({
      originalProductDescription: "x",
      requestedQuantity: "1.23456",
      requestedUnitCode: "EA",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a quantity with exactly 4 decimal places", () => {
    const result = orderLineInputSchema.safeParse({
      originalProductDescription: "x",
      requestedQuantity: "1.2345",
      requestedUnitCode: "EA",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing originalProductDescription", () => {
    const result = orderLineInputSchema.safeParse({
      requestedQuantity: "1",
      requestedUnitCode: "EA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing requestedUnitCode", () => {
    const result = orderLineInputSchema.safeParse({
      originalProductDescription: "x",
      requestedQuantity: "1",
    });
    expect(result.success).toBe(false);
  });
});
