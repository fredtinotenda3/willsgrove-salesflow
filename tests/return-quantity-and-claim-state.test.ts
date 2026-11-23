import { describe, expect, it } from "vitest";
import { checkReturnQuantity } from "@/lib/returns-credits/return-quantity";
import { deriveClaimFacet, deriveReturnFacet, sumQuantities } from "@/lib/invoice-claims/invoice-claim-state";

describe("checkReturnQuantity", () => {
  it("allows a return up to the remaining disputed quantity", () => {
    expect(checkReturnQuantity({ receivedQuantity: "4", alreadyReturned: "6", eligibleQuantity: "10" })).toEqual({ ok: true, remainingAfter: "0" });
  });
  it("rejects a return above what remains, counting earlier returns", () => {
    const result = checkReturnQuantity({ receivedQuantity: "5", alreadyReturned: "6", eligibleQuantity: "10" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.remaining).toBe("4");
  });
  it("rejects any return when nothing was disputed", () => {
    expect(checkReturnQuantity({ receivedQuantity: "1", alreadyReturned: "0", eligibleQuantity: "0" }).ok).toBe(false);
  });
  it("is exact at 4dp", () => {
    expect(checkReturnQuantity({ receivedQuantity: "0.1", alreadyReturned: "0.2", eligibleQuantity: "0.3" }).ok).toBe(true);
  });
});

describe("invoice claim state", () => {
  it("derives the claim facet", () => {
    expect(deriveClaimFacet([])).toBe("NO_CLAIM");
    expect(deriveClaimFacet(["OPEN"])).toBe("CLAIM_RECORDED");
    expect(deriveClaimFacet(["OPEN", "UNDER_INVESTIGATION"])).toBe("PENDING_RESOLUTION");
    expect(deriveClaimFacet(["APPROVED"])).toBe("PENDING_RESOLUTION");
    expect(deriveClaimFacet(["RESOLVED", "CLOSED", "REJECTED"])).toBe("RESOLVED");
    expect(deriveClaimFacet(["RESOLVED", "OPEN"])).toBe("PENDING_RESOLUTION");
  });
  it("derives the return facet against the invoiced quantity", () => {
    expect(deriveReturnFacet("0", "10")).toBe("NONE");
    expect(deriveReturnFacet("3", "10")).toBe("PARTIAL_RETURN");
    expect(deriveReturnFacet("10", "10")).toBe("FULL_RETURN");
  });
  it("sums quantities exactly and ignores nulls", () => {
    expect(sumQuantities(["0.1", "0.2", null, undefined])).toBe("0.3");
  });
});
