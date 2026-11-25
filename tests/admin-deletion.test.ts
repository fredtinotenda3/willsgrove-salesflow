import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The deletion policy is the contract that stops an administrator removing
 * records the business must keep. Pure verdict rules are tested directly; the
 * transactional service is tested against a mocked Prisma client (no database).
 */
vi.mock("server-only", () => ({}));

const { tx, prismaMock, auditCreate } = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn(), delete: vi.fn(), create: vi.fn() });
  const names = ["customerOrder", "orderStatusHistory", "orderLine", "quotation", "integrationOperation", "productVerification", "priceDecision", "customer", "customerContact", "customerAlias", "sapInvoice", "invoiceClaim", "unfulfilledDemand", "messageIntake", "outboundMessage", "decisionRecommendation", "claimReturnLostSale", "product", "priceList", "priceListEntry", "productAlias", "quotationLine", "sapInvoiceLine", "stockSnapshotLine", "auditEvent"];
  const tx = Object.fromEntries(names.map((n) => [n, model()])) as Record<string, ReturnType<typeof model>>;
  const prismaMock = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { tx, prismaMock, auditCreate: tx.auditEvent.create };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { checkCustomerDeletable, checkOrderDeletable, checkPriceListDeletable, checkProductDeletable, DELETION_POLICY, describeBlockers, type OrderDeleteFacts } from "@/lib/admin/deletion-policy";
import { deleteDraftOrder } from "@/lib/admin/record-deletion";

const zeroCounts: OrderDeleteFacts["counts"] = { documents: 0, approvals: 0, approvalRequests: 0, pickingSessions: 0, handovers: 0, dispatchRecords: 0, matchedInvoices: 0, matchedInvoiceLines: 0, claims: 0, demands: 0, integrationOperations: 0, messageIntakes: 0, outboundMessages: 0, recommendations: 0, sourceQuotations: 0, verifications: 0, priceDecisions: 0 };
const facts = (over: Partial<OrderDeleteFacts> = {}): OrderDeleteFacts => ({ status: "DRAFT", handedToSapAt: null, invoicedAt: null, counts: { ...zeroCounts }, ...over });

describe("order deletion verdict", () => {
  it("allows an unreferenced DRAFT", () => expect(checkOrderDeletable(facts())).toEqual({ deletable: true }));
  it("refuses every non-DRAFT status and says to cancel instead", () => {
    for (const status of ["SUBMITTED", "APPROVED", "CANCELLED", "INVOICED", "DELIVERED"]) {
      const v = checkOrderDeletable(facts({ status }));
      expect(v.deletable).toBe(false);
      if (!v.deletable) expect(v.reason).toMatch(/cancel/i);
    }
  });
  it("refuses a draft already handed to SAP or invoiced", () => {
    expect(checkOrderDeletable(facts({ handedToSapAt: new Date() })).deletable).toBe(false);
    expect(checkOrderDeletable(facts({ invoicedAt: new Date() })).deletable).toBe(false);
  });
  it("refuses a draft with any downstream trace and names each blocker with its count", () => {
    for (const key of Object.keys(zeroCounts) as (keyof typeof zeroCounts)[]) {
      expect(checkOrderDeletable(facts({ counts: { ...zeroCounts, [key]: 1 } })).deletable, key).toBe(false);
    }
    const v = checkOrderDeletable(facts({ counts: { ...zeroCounts, claims: 2, matchedInvoices: 1 } }));
    expect(v.deletable).toBe(false);
    if (!v.deletable) { expect(v.blockers).toHaveLength(2); expect(v.reason).toContain("2 invoice claim"); expect(v.reason).toContain("1 matched SAP invoice"); }
  });
});

describe("customer / product / price list verdicts", () => {
  it("allow only when nothing refers to the record", () => {
    expect(checkCustomerDeletable({ orders: 0, quotations: 0 })).toEqual({ deletable: true });
    expect(checkProductDeletable({ orderLines: 0 })).toEqual({ deletable: true });
    expect(checkPriceListDeletable({ entries: 0, customers: 0 })).toEqual({ deletable: true });
  });
  it("refuse and explain when referenced", () => {
    const c = checkCustomerDeletable({ orders: 3, claims: 1, quotations: 0 });
    expect(c.deletable).toBe(false);
    if (!c.deletable) expect(describeBlockers(c.blockers)).toBe("3 order(s), 1 claim(s)");
    expect(checkProductDeletable({ orderLines: 1 }).deletable).toBe(false);
    expect(checkPriceListDeletable({ entries: 4, customers: 0 }).deletable).toBe(false);
  });
});

describe("deletion policy table", () => {
  it("covers each entity once and never offers hard delete for financial or audit records", () => {
    const names = DELETION_POLICY.map((p) => p.entity);
    expect(new Set(names).size).toBe(names.length);
    for (const protectedEntity of ["Audit event", "SAP invoice, lines and import batch", "Invoice claim, resolution, attachment", "Credit note and return", "User", "Quotation", "Order line"]) {
      const p = DELETION_POLICY.find((x) => x.entity === protectedEntity);
      expect(p, protectedEntity).toBeDefined();
      expect(p!.kinds).not.toContain("HARD_DELETE_IF_UNREFERENCED");
    }
    expect(DELETION_POLICY.every((p) => p.kinds.length > 0 && p.summary && p.alternative)).toBe(true);
  });
});

const orderRow = (over: Record<string, unknown> = {}) => ({ reference: "ORD-1", status: "DRAFT", handedToSapAt: null, invoicedAt: null, customerId: "c1", total: { toString: () => "10.00" }, createdAt: new Date("2026-01-01T00:00:00Z"), _count: new Proxy({ lines: 2 }, { get: (t, k) => (k in t ? (t as Record<string | symbol, number>)[k] : 0) }), ...over });

beforeEach(() => {
  for (const m of Object.values(tx)) for (const f of Object.values(m)) (f as ReturnType<typeof vi.fn>).mockReset();
  for (const m of Object.values(tx)) m.count.mockResolvedValue(0);
  auditCreate.mockResolvedValue({});
});

describe("deleteDraftOrder (transactional)", () => {
  it("deletes children then the order, and writes the audit snapshot in the same transaction", async () => {
    tx.customerOrder.findUnique.mockResolvedValue(orderRow());
    tx.customerOrder.deleteMany.mockResolvedValue({ count: 1 });
    const r = await deleteDraftOrder("o1", "duplicate draft", "a1");
    expect(r).toEqual({ ok: true });
    expect(tx.orderLine.deleteMany).toHaveBeenCalledWith({ where: { orderId: "o1" } });
    expect(tx.customerOrder.deleteMany).toHaveBeenCalledWith({ where: { id: "o1", status: "DRAFT" } });
    const data = auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorId: "a1", action: "ORDER_ADMIN_DELETE", entityType: "CustomerOrder", entityId: "o1", beforeData: { reference: "ORD-1", status: "DRAFT", lines: 2 }, afterData: { deleted: true, reason: "duplicate draft", outcome: "SUCCESS" } });
  });

  it("refuses a non-draft order, deletes nothing and records the refusal", async () => {
    tx.customerOrder.findUnique.mockResolvedValue(orderRow({ status: "APPROVED" }));
    const r = await deleteDraftOrder("o1", "cleanup", "a1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(tx.orderLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.customerOrder.deleteMany).not.toHaveBeenCalled();
    expect(auditCreate.mock.calls.map((c) => c[0].data)).toEqual([expect.objectContaining({ action: "CUSTOMERORDER_DELETE_REFUSED", afterData: expect.objectContaining({ outcome: "REFUSED" }) })]);
  });

  it("refuses when a dependency exists that the page did not show (counts are recomputed in the transaction)", async () => {
    tx.customerOrder.findUnique.mockResolvedValue(orderRow());
    tx.productVerification.count.mockResolvedValue(1);
    const r = await deleteDraftOrder("o1", "cleanup", "a1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(tx.customerOrder.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing order", async () => {
    tx.customerOrder.findUnique.mockResolvedValue(null);
    expect(await deleteDraftOrder("nope", "x", "a1")).toMatchObject({ ok: false, status: 404 });
  });

  it("detects a status change racing the delete (count 0) and aborts", async () => {
    tx.customerOrder.findUnique.mockResolvedValue(orderRow());
    tx.customerOrder.deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteDraftOrder("o1", "x", "a1")).toMatchObject({ ok: false, status: 409 });
    expect(auditCreate.mock.calls.every((c) => c[0].data.afterData.outcome === "REFUSED")).toBe(true);
  });

  it("maps a foreign-key violation to a 409 refusal instead of a 500", async () => {
    const { Prisma } = await import("@prisma/client");
    tx.customerOrder.findUnique.mockResolvedValue(orderRow());
    tx.customerOrder.deleteMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" }));
    expect(await deleteDraftOrder("o1", "x", "a1")).toMatchObject({ ok: false, status: 409 });
  });

  it("rethrows unexpected errors", async () => {
    tx.customerOrder.findUnique.mockRejectedValue(new Error("db down"));
    await expect(deleteDraftOrder("o1", "x", "a1")).rejects.toThrow("db down");
  });
});
