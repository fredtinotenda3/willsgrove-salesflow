import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Invoice-recording protection: pure rules + the reset service's decision
 * logic against a mocked Prisma client (no database needed). The real
 * row-lock / transaction behaviour is covered by
 * invoice-recording-db.integration.test.ts, which needs a live Postgres.
 */

const tx = {
  $queryRaw: vi.fn(),
  sapInvoice: { findFirst: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  sapInvoiceLine: { findMany: vi.fn(), aggregate: vi.fn() },
  dispatchLine: { aggregate: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

import { describeResetBlockers, resetNativeInvoiceSchema } from "@/lib/invoice-recording/validation";
import { resetNativeInvoice } from "@/lib/invoice-recording/reset-native-invoice";

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv1",
    sapDocNum: "SF-INV-20261124-ABCD1234",
    total: { toString: () => "120.0000" },
    currencyCode: "USD",
    isCancelledOrReversed: false,
    rawSourceData: { source: "NATIVE_RECORDING", recordedById: "u0" },
    _count: { claims: 0, creditNotes: 0 },
    deliveryRecord: null,
    ...overrides,
  };
}

describe("resetNativeInvoiceSchema", () => {
  it("requires a meaningful reason", () => {
    expect(resetNativeInvoiceSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(resetNativeInvoiceSchema.safeParse({ reason: "abc" }).success).toBe(false);
    expect(resetNativeInvoiceSchema.safeParse({ reason: "   ab   " }).success).toBe(false);
    expect(resetNativeInvoiceSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(resetNativeInvoiceSchema.safeParse({ reason: "Wrong quantities" })).toMatchObject({ success: true, data: { reason: "Wrong quantities" } });
  });
});

describe("describeResetBlockers", () => {
  it("is empty when nothing depends on the invoice", () => {
    expect(describeResetBlockers({ claims: 0, creditNotes: 0, hasDeliveryRecord: false })).toEqual([]);
  });
  it("names every dependent record type", () => {
    const blockers = describeResetBlockers({ claims: 2, creditNotes: 1, hasDeliveryRecord: true });
    expect(blockers).toHaveLength(3);
    expect(blockers.join(" ")).toMatch(/2 invoice claim/);
    expect(blockers.join(" ")).toMatch(/1 credit note/);
    expect(blockers.join(" ")).toMatch(/delivery outcome/);
  });
});

describe("resetNativeInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([]);
    // Default: nothing has been dispatched against this invoice's lines.
    tx.sapInvoiceLine.findMany.mockResolvedValue([]);
    tx.sapInvoiceLine.aggregate.mockResolvedValue({ _sum: { quantityInvoiced: null } });
    tx.dispatchLine.aggregate.mockResolvedValue({ _sum: { dispatchedQuantity: null } });
  });

  it("refuses when goods have already been dispatched against the invoice", async () => {
    tx.sapInvoice.findFirst.mockResolvedValue(invoiceFixture());
    tx.sapInvoiceLine.findMany.mockResolvedValue([{ matchedOrderLineId: "ol1", quantityInvoiced: new Prisma.Decimal(10) }]);
    tx.sapInvoiceLine.aggregate.mockResolvedValue({ _sum: { quantityInvoiced: new Prisma.Decimal(10) } });
    tx.dispatchLine.aggregate.mockResolvedValue({ _sum: { dispatchedQuantity: new Prisma.Decimal(4) } });
    const result = await resetNativeInvoice("ord1", "inv1", "mgr1", { reason: "Wrong quantities" });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(tx.sapInvoice.update).not.toHaveBeenCalled();
  });

  it("voids a native invoice, locks the order first, and writes an audit event", async () => {
    tx.sapInvoice.findFirst.mockResolvedValue(invoiceFixture());
    const result = await resetNativeInvoice("ord1", "inv1", "mgr1", { reason: "Wrong quantities" });
    expect(result).toEqual({ ok: true, sapDocNum: "SF-INV-20261124-ABCD1234" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.sapInvoice.findFirst.mock.invocationCallOrder[0]);
    const update = tx.sapInvoice.update.mock.calls[0][0];
    expect(update.data.isCancelledOrReversed).toBe(true);
    expect(update.data.rawSourceData.source).toBe("NATIVE_RECORDING");
    expect(update.data.rawSourceData.reset).toMatchObject({ byId: "mgr1", reason: "Wrong quantities" });
    const audit = tx.auditEvent.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ actorId: "mgr1", action: "INVOICE_RESET_NATIVE", entityType: "SapInvoice", entityId: "inv1" });
    expect(audit.afterData.reason).toBe("Wrong quantities");
  });

  it("404s when the invoice is not on this order", async () => {
    tx.sapInvoice.findFirst.mockResolvedValue(null);
    const result = await resetNativeInvoice("ord1", "nope", "mgr1", { reason: "Wrong quantities" });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(tx.sapInvoice.update).not.toHaveBeenCalled();
  });

  it("refuses to reset a SAP-imported invoice", async () => {
    tx.sapInvoice.findFirst.mockResolvedValue(invoiceFixture({ rawSourceData: { source: "SAP_IMPORT" } }));
    const result = await resetNativeInvoice("ord1", "inv1", "mgr1", { reason: "Wrong quantities" });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(tx.sapInvoice.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("refuses a second reset (idempotent, no duplicate audit row)", async () => {
    tx.sapInvoice.findFirst.mockResolvedValue(invoiceFixture({ isCancelledOrReversed: true }));
    const result = await resetNativeInvoice("ord1", "inv1", "mgr1", { reason: "Wrong quantities" });
    expect(result).toMatchObject({ ok: false, status: 409, message: expect.stringMatching(/already been reset/) });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a claim", { _count: { claims: 1, creditNotes: 0 } }, /claim/],
    ["a credit note", { _count: { claims: 0, creditNotes: 1 } }, /credit note/],
    ["a delivery outcome", { deliveryRecord: { id: "d1" } }, /delivery outcome/],
  ])("refuses when %s depends on the invoice", async (_label, override, pattern) => {
    tx.sapInvoice.findFirst.mockResolvedValue(invoiceFixture(override));
    const result = await resetNativeInvoice("ord1", "inv1", "mgr1", { reason: "Wrong quantities" });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as { message: string }).message).toMatch(pattern);
    expect(tx.sapInvoice.update).not.toHaveBeenCalled();
  });
});
