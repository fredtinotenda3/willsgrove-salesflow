import { describe, it, expect } from "vitest";
import { createOrderSchema, orderLineInputSchema } from "@/lib/order-validation";

// NOTE: this file imports `OrderSource` from `@prisma/client` as a runtime
// value (for `z.nativeEnum(OrderSource)`). In this sandbox, `@prisma/client`
// is only a stub (the real client could never be generated here -- see
// PROGRESS.md) and does not export schema-derived enums at all, so this
// import is expected to produce `undefined` at best, or throw at import
// time. This file exists to honestly record what actually happens; it is
// expected to fail in this sandbox and is expected to pass unmodified once
// `prisma generate` has run successfully on a real machine.

describe("createOrderSchema (depends on a real generated Prisma client)", () => {
  it("validates a well-formed order payload", () => {
    const result = createOrderSchema.safeParse({
      customerId: "cust_123",
      customerLocationId: "loc_123",
      source: "WHATSAPP",
      lines: [{ productId: "prod_123", quantity: "10" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative or non-decimal quantity string", () => {
    const result = orderLineInputSchema.safeParse({ productId: "prod_123", quantity: "-5" });
    expect(result.success).toBe(false);
  });
});
