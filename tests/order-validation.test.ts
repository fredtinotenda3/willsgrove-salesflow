import { describe, it, expect } from "vitest";
import { createOrderSchema, orderLineInputSchema } from "@/lib/order-validation";

// Milestone 2B update: this file previously could not even be imported in
// the build sandbox, because lib/order-validation.ts used to import
// `OrderSource` from `@prisma/client` as a runtime value (for
// `z.nativeEnum(OrderSource)`), and this sandbox's stub `@prisma/client`
// exports every schema-derived enum as `undefined` (see PROGRESS.md's
// "Sandbox-only blocker"). That dependency was removed as part of a real
// correctness tightening (see lib/order-validation.ts's own comment on
// MANUAL_ENTRY_ORDER_SOURCES): the public create-order endpoint only ever
// needs to accept EMAIL/WHATSAPP/MANUAL, so the schema now validates
// against a plain literal tuple instead of the full live enum, needing no
// runtime import of the Prisma client at all. This file now runs
// identically in the sandbox and on a real machine.

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

  it("accepts a payload with zero order lines (Milestone 0 fix round 2: an order submitted via pasted text or an uploaded document alone -- modes (b)/(c) -- has no manual lines yet and waits for review; see lib/order-validation.ts's comment on this)", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "MANUAL",
      originalSourceText: "Please send 10 boxes of apples, usual terms.",
      lines: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with zero order lines and no originalSourceText either (the file-only intake mode -- the document itself is uploaded in a separate request after the order exists, so this schema has no way to require it)", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "EMAIL",
      lines: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with originalSourceText set", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "WHATSAPP",
      originalSourceText: "Hi, please send the usual order for this week.",
      lines: [
        {
          originalProductDescription: "Apples G/D Econ 1.5kg",
          requestedQuantity: "10",
          requestedUnitCode: "EA",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an originalSourceText longer than 5000 characters", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "EMAIL",
      originalSourceText: "x".repeat(5001),
      lines: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 200 order lines", () => {
    const line = {
      originalProductDescription: "x",
      requestedQuantity: "1",
      requestedUnitCode: "EA",
    };
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      source: "MANUAL",
      lines: Array.from({ length: 201 }, () => line),
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
