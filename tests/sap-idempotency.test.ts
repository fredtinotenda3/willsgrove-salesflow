import { describe, it, expect } from "vitest";
import { buildSapSalesOrderIdempotencyKey } from "@/lib/integrations/sap/idempotency";

/**
 * Milestone 9 (SAP Business One Integration). Trivial but important --
 * the whole outbox dedupe guarantee (lib/integrations/sap/order-outbox.ts's
 * IntegrationOperation.idempotencyKey uniqueness constraint) depends on
 * this being a pure, deterministic function of customerOrderId alone.
 */
describe("buildSapSalesOrderIdempotencyKey", () => {
  it("has the documented SAP-SO-<customerOrderId> shape", () => {
    expect(buildSapSalesOrderIdempotencyKey("order-abc-123")).toBe("SAP-SO-order-abc-123");
  });

  it("is deterministic: the same order id always yields the same key", () => {
    const a = buildSapSalesOrderIdempotencyKey("order-xyz-789");
    const b = buildSapSalesOrderIdempotencyKey("order-xyz-789");
    expect(a).toBe(b);
  });

  it("is distinct for distinct order ids", () => {
    expect(buildSapSalesOrderIdempotencyKey("order-1")).not.toBe(buildSapSalesOrderIdempotencyKey("order-2"));
  });
});
