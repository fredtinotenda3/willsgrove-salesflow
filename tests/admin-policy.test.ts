import { describe, expect, it } from "vitest";
import { checkAdministratorContinuity, duplicateKey, isEligibleAssignee, isReassignableClaimStatus, isReassignableOrderStatus, isReassignableQuotation, normaliseReason } from "@/lib/admin/policy";

const admin = { id: "a1", role: "ADMINISTRATOR" as const, status: "ACTIVE" as const };

describe("administrator continuity", () => {
  it("blocks deactivating the last active administrator", () => {
    const r = checkAdministratorContinuity({ actorId: "other", target: admin, next: { role: "ADMINISTRATOR", status: "INACTIVE" }, otherActiveAdministrators: 0 });
    expect(r.ok).toBe(false);
  });
  it("blocks demoting the last active administrator", () => {
    expect(checkAdministratorContinuity({ actorId: "x", target: admin, next: { role: "SALES_MANAGER", status: "ACTIVE" }, otherActiveAdministrators: 0 }).ok).toBe(false);
  });
  it("allows removing an administrator when another active one remains", () => {
    expect(checkAdministratorContinuity({ actorId: "x", target: admin, next: { role: "SALESPERSON", status: "ACTIVE" }, otherActiveAdministrators: 1 }).ok).toBe(true);
  });
  it("never lets an administrator demote or deactivate themselves", () => {
    expect(checkAdministratorContinuity({ actorId: "a1", target: admin, next: { role: "SALESPERSON", status: "ACTIVE" }, otherActiveAdministrators: 5 }).ok).toBe(false);
    expect(checkAdministratorContinuity({ actorId: "a1", target: admin, next: { role: "ADMINISTRATOR", status: "INACTIVE" }, otherActiveAdministrators: 5 }).ok).toBe(false);
  });
  it("does not constrain non-administrators or unchanged admins", () => {
    expect(checkAdministratorContinuity({ actorId: "x", target: { id: "u", role: "SALESPERSON", status: "ACTIVE" }, next: { role: "SALESPERSON", status: "INACTIVE" }, otherActiveAdministrators: 0 }).ok).toBe(true);
    expect(checkAdministratorContinuity({ actorId: "x", target: admin, next: { role: "ADMINISTRATOR", status: "ACTIVE" }, otherActiveAdministrators: 0 }).ok).toBe(true);
  });
});

describe("assignment eligibility", () => {
  it("only active users can receive work", () => {
    expect(isEligibleAssignee({ status: "ACTIVE" })).toBe(true);
    expect(isEligibleAssignee({ status: "INACTIVE" })).toBe(false);
    expect(isEligibleAssignee(null)).toBe(false);
  });
  it("protects invoiced, rejected and cancelled orders", () => {
    for (const s of ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"]) expect(isReassignableOrderStatus(s)).toBe(true);
    for (const s of ["READY_TO_INVOICE", "REJECTED", "CANCELLED"]) expect(isReassignableOrderStatus(s)).toBe(false);
  });
  it("only open, unconverted, unsuperseded quotations are reassignable", () => {
    expect(isReassignableQuotation({ status: "ISSUED", convertedOrderId: null, supersededAt: null })).toBe(true);
    expect(isReassignableQuotation({ status: "ACCEPTED", convertedOrderId: null, supersededAt: null })).toBe(false);
    expect(isReassignableQuotation({ status: "DRAFT", convertedOrderId: "o1", supersededAt: null })).toBe(false);
    expect(isReassignableQuotation({ status: "ISSUED", convertedOrderId: null, supersededAt: new Date() })).toBe(false);
  });
  it("concluded claims keep their owner", () => {
    expect(isReassignableClaimStatus("OPEN")).toBe(true);
    for (const s of ["RESOLVED", "REJECTED", "CLOSED"]) expect(isReassignableClaimStatus(s)).toBe(false);
  });
});

describe("helpers", () => {
  it("requires a meaningful reason", () => {
    expect(normaliseReason("  ab ")).toBeNull();
    expect(normaliseReason("  left   the company ")).toBe("left the company");
    expect(normaliseReason(5)).toBeNull();
  });
  it("normalises duplicate keys", () => {
    expect(duplicateKey("Mega  Foods (Pvt) Ltd.")).toBe(duplicateKey("mega foods pvt ltd"));
  });
});

import { checkOrderCancellable, checkOrderEditable, checkOrderReopenable, classifyPriceEntries, isValidPriceString, windowsOverlap, type OrderGuardFacts } from "@/lib/admin/order-policy";

const order = (o: Partial<OrderGuardFacts> = {}): OrderGuardFacts => ({ status: "APPROVED", handedToSapAt: null, invoicedAt: null, pickingSessions: 0, pendingApprovals: 0, invoiceMatches: 0, ...o });

describe("order guards", () => {
  it("allows editing and cancelling before fulfilment", () => {
    expect(checkOrderEditable(order()).ok).toBe(true);
    expect(checkOrderCancellable(order({ status: "DRAFT" })).ok).toBe(true);
  });
  it("protects picking, handed-over, invoiced and closed orders", () => {
    expect(checkOrderEditable(order({ status: "PICKING" })).ok).toBe(false);
    expect(checkOrderEditable(order({ status: "READY_TO_INVOICE" })).ok).toBe(false);
    expect(checkOrderEditable(order({ handedToSapAt: new Date() })).ok).toBe(false);
    expect(checkOrderEditable(order({ invoiceMatches: 1 })).ok).toBe(false);
    expect(checkOrderCancellable(order({ pickingSessions: 1 })).ok).toBe(false);
    expect(checkOrderCancellable(order({ pendingApprovals: 1 })).ok).toBe(false);
    expect(checkOrderCancellable(order({ status: "CANCELLED" })).ok).toBe(false);
  });
  it("reopens only cancelled/rejected orders that never reached SAP or an invoice", () => {
    expect(checkOrderReopenable(order({ status: "CANCELLED" })).ok).toBe(true);
    expect(checkOrderReopenable(order({ status: "REJECTED" })).ok).toBe(true);
    expect(checkOrderReopenable(order({ status: "APPROVED" })).ok).toBe(false);
    expect(checkOrderReopenable(order({ status: "CANCELLED", invoicedAt: new Date() })).ok).toBe(false);
    expect(checkOrderReopenable(order({ status: "CANCELLED", handedToSapAt: new Date() })).ok).toBe(false);
  });
});

describe("price entries", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it("detects overlapping windows including open-ended ones", () => {
    expect(windowsOverlap({ validFrom: d("2026-01-01"), validTo: d("2026-03-31") }, { validFrom: d("2026-03-31"), validTo: null })).toBe(true);
    expect(windowsOverlap({ validFrom: d("2026-01-01"), validTo: d("2026-03-30") }, { validFrom: d("2026-03-31"), validTo: null })).toBe(false);
    expect(windowsOverlap({ validFrom: d("2026-01-01"), validTo: null }, { validFrom: d("2027-01-01"), validTo: null })).toBe(true);
  });
  it("classifies current, expired, future and conflicting prices", () => {
    const now = d("2026-06-15");
    const m = classifyPriceEntries([
      { id: "a", sapItemCode: "X", unitPrice: "1", validFrom: d("2026-01-01"), validTo: d("2026-03-01") },
      { id: "b", sapItemCode: "X", unitPrice: "2", validFrom: d("2026-03-02"), validTo: null },
      { id: "c", sapItemCode: "Y", unitPrice: "3", validFrom: d("2026-01-01"), validTo: null },
      { id: "d", sapItemCode: "Y", unitPrice: "4", validFrom: d("2026-02-01"), validTo: null },
      { id: "e", sapItemCode: "Z", unitPrice: "5", validFrom: d("2027-01-01"), validTo: null },
    ], now);
    expect([m.get("a"), m.get("b"), m.get("c"), m.get("d"), m.get("e")]).toEqual(["expired", "current", "conflict", "conflict", "future"]);
  });
  it("accepts only exact positive decimals", () => {
    for (const ok of ["0.45", "12", "1234.5678"]) expect(isValidPriceString(ok)).toBe(true);
    for (const bad of ["0", "-1", "1e3", "1.23456", "abc", "", "1,5"]) expect(isValidPriceString(bad)).toBe(false);
  });
});
