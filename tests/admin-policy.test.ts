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
