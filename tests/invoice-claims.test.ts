import { describe, it, expect } from "vitest";
import {
  validateClaimStatusTransition,
  isApprovalWeightStatus,
  isConcludedStatus,
  resolutionDecisionToClaimStatus,
  resolutionDecisionRequiresDetail,
  claimCategoryRequiresDetail,
  validateClaimLineQuantities,
  validateDisputedAmount,
  CLAIM_STATUSES,
  RESOLUTION_DECISIONS,
  CLAIM_LINE_REASON_CATEGORIES,
  CLAIM_LINE_REASON_CATEGORY_LABELS,
  claimLineInputSchema,
  createInvoiceClaimSchema,
  isNativeClaimInput,
} from "@/lib/invoice-claims/validation";

/**
 * Milestone 6A (Invoice Claims Management). Pure, unconditional tests for
 * lib/invoice-claims/validation.ts -- no @prisma/client import anywhere in
 * that module, so these run in every environment, same as
 * tests/invoice-reconciliation.test.ts and tests/picking-validation.test.ts.
 */

describe("Milestone 6A: claim status transition graph", () => {
  it("allows the plain investigation-workflow moves without requiring approval", () => {
    expect(validateClaimStatusTransition("OPEN", "UNDER_INVESTIGATION")).toEqual({ ok: true, requiresApproval: false });
    expect(validateClaimStatusTransition("OPEN", "AWAITING_CUSTOMER")).toEqual({ ok: true, requiresApproval: false });
    expect(validateClaimStatusTransition("UNDER_INVESTIGATION", "AWAITING_INTERNAL_ACTION")).toEqual({ ok: true, requiresApproval: false });
    expect(validateClaimStatusTransition("AWAITING_CUSTOMER", "UNDER_INVESTIGATION")).toEqual({ ok: true, requiresApproval: false });
  });

  it("flags every approval-weight transition as requiring approval", () => {
    const result = validateClaimStatusTransition("AWAITING_INTERNAL_ACTION", "APPROVED");
    expect(result).toEqual({ ok: true, requiresApproval: true });
    for (const target of ["APPROVED", "PARTIALLY_RESOLVED", "RESOLVED", "REJECTED", "CLOSED"] as const) {
      expect(isApprovalWeightStatus(target)).toBe(true);
    }
    for (const target of ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION"] as const) {
      expect(isApprovalWeightStatus(target)).toBe(false);
    }
  });

  it("rejects a transition not on the graph (cannot skip investigation/approval steps)", () => {
    const result = validateClaimStatusTransition("OPEN", "RESOLVED");
    expect(result.ok).toBe(false);
  });

  it("rejects a no-op transition (same status to itself)", () => {
    const result = validateClaimStatusTransition("OPEN", "OPEN");
    expect(result.ok).toBe(false);
  });

  it("treats CLOSED as terminal -- no outgoing transitions at all", () => {
    for (const target of CLAIM_STATUSES) {
      if (target === "CLOSED") continue;
      expect(validateClaimStatusTransition("CLOSED", target).ok).toBe(false);
    }
  });

  it("every status has a defined (possibly empty) set of allowed transitions", () => {
    // Exhaustiveness is enforced by the TypeScript Record<ClaimStatus, ...>
    // type at compile time; this just confirms every status is reachable
    // as a FROM state without throwing.
    for (const status of CLAIM_STATUSES) {
      expect(() => validateClaimStatusTransition(status, status)).not.toThrow();
    }
  });
});

describe("Milestone 6A: isConcludedStatus", () => {
  it("is true for every status that counts toward average-resolution-time reporting", () => {
    expect(isConcludedStatus("RESOLVED")).toBe(true);
    expect(isConcludedStatus("PARTIALLY_RESOLVED")).toBe(true);
    expect(isConcludedStatus("REJECTED")).toBe(true);
    expect(isConcludedStatus("CLOSED")).toBe(true);
  });

  it("is false for every in-progress status, including APPROVED (a recommendation approved but not yet fully resolved)", () => {
    expect(isConcludedStatus("OPEN")).toBe(false);
    expect(isConcludedStatus("UNDER_INVESTIGATION")).toBe(false);
    expect(isConcludedStatus("AWAITING_CUSTOMER")).toBe(false);
    expect(isConcludedStatus("AWAITING_INTERNAL_ACTION")).toBe(false);
    expect(isConcludedStatus("APPROVED")).toBe(false);
  });
});

describe("Milestone 6A: resolutionDecisionToClaimStatus (structural, exhaustive)", () => {
  it("maps every decision to exactly one status, and every mapping is a VALID transition from AWAITING_INTERNAL_ACTION", () => {
    for (const decision of RESOLUTION_DECISIONS) {
      const target = resolutionDecisionToClaimStatus(decision);
      expect(CLAIM_STATUSES).toContain(target);
      const transition = validateClaimStatusTransition("AWAITING_INTERNAL_ACTION", target);
      expect(transition.ok).toBe(true);
    }
  });

  it("DELIVERY_INVESTIGATION_REQUIRED sends the claim back to investigation, not forward to an approval-weight status", () => {
    expect(resolutionDecisionToClaimStatus("DELIVERY_INVESTIGATION_REQUIRED")).toBe("UNDER_INVESTIGATION");
  });

  it("CLAIM_REJECTED maps to REJECTED and NO_ACTION_REQUIRED maps to RESOLVED", () => {
    expect(resolutionDecisionToClaimStatus("CLAIM_REJECTED")).toBe("REJECTED");
    expect(resolutionDecisionToClaimStatus("NO_ACTION_REQUIRED")).toBe("RESOLVED");
  });

  it("every credit/return/pricing/replacement decision maps to APPROVED -- the claim still needs a further explicit move to RESOLVED/PARTIALLY_RESOLVED", () => {
    for (const decision of ["REPLACEMENT_APPROVED", "PHYSICAL_RETURN_REQUIRED", "PARTIAL_CREDIT_RECOMMENDED", "FULL_CREDIT_RECOMMENDED", "PRICING_CORRECTION_REQUIRED", "OTHER"] as const) {
      expect(resolutionDecisionToClaimStatus(decision)).toBe("APPROVED");
    }
  });
});

describe("Milestone 6A: 'Other requires detail'", () => {
  it("only OTHER requires a decision detail", () => {
    expect(resolutionDecisionRequiresDetail("OTHER")).toBe(true);
    expect(resolutionDecisionRequiresDetail("CLAIM_REJECTED")).toBe(false);
  });

  it("only OTHER requires a category detail", () => {
    expect(claimCategoryRequiresDetail("OTHER")).toBe(true);
    expect(claimCategoryRequiresDetail("QUALITY_ISSUE")).toBe(false);
  });
});

describe("Milestone 6A: claim-line quantity validation (spec worked example: 100 invoiced, 15 disputed -> 85 accepted / 15 rejected)", () => {
  it("accepts the worked example exactly", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "85.0000", "15.0000");
    expect(result.ok).toBe(true);
  });

  it("rejects accepted + rejected exceeding the invoiced quantity", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "90.0000", "15.0000");
    expect(result.ok).toBe(false);
  });

  it("accounts for quantity already claimed by an EARLIER claim against the same invoice line (live aggregate, not just within one claim)", () => {
    // 100 invoiced, 20 already claimed (accepted+rejected) by an earlier
    // claim -> only 80 remains. A new claim disputing 85 must fail even
    // though 85 alone would have been fine against the full 100.
    const result = validateClaimLineQuantities("100.0000", "20.0000", "0.0000", "85.0000");
    expect(result.ok).toBe(false);
  });

  it("allows a second claim that fits within what remains after an earlier claim", () => {
    const result = validateClaimLineQuantities("100.0000", "20.0000", "0.0000", "80.0000");
    expect(result.ok).toBe(true);
  });

  it("rejects a line where neither accepted nor rejected is greater than zero", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "0.0000", "0.0000");
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed decimal string", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "abc", "0.0000");
    expect(result.ok).toBe(false);
  });

  it("supports full rejection (0 accepted, full quantity rejected)", () => {
    const result = validateClaimLineQuantities("50.0000", "0.0000", "0.0000", "50.0000");
    expect(result.ok).toBe(true);
  });

  it("supports partial acceptance (both accepted and rejected greater than zero, summing to exactly the invoiced quantity)", () => {
    const result = validateClaimLineQuantities("50.0000", "0.0000", "30.0000", "20.0000");
    expect(result.ok).toBe(true);
  });
});

describe("Milestone 6A: amount-only dispute validation", () => {
  it("accepts a positive disputed amount with no line total to check against (SAP export didn't provide one)", () => {
    const result = validateDisputedAmount("25.0000", null);
    expect(result.ok).toBe(true);
  });

  it("rejects a zero disputed amount", () => {
    const result = validateDisputedAmount("0.0000", "100.0000");
    expect(result.ok).toBe(false);
  });

  it("rejects a disputed amount exceeding the invoice line's own total", () => {
    const result = validateDisputedAmount("150.0000", "100.0000");
    expect(result.ok).toBe(false);
  });

  it("accepts a disputed amount within the invoice line's own total", () => {
    const result = validateDisputedAmount("99.9999", "100.0000");
    expect(result.ok).toBe(true);
  });
});

/**
 * Management Analytics / Claims Standardisation spec, Part 4: the
 * per-line claim-reason dropdown must offer EXACTLY these 8
 * standardised reasons, in this exact order and wording. This
 * supersedes the earlier "Final Operational Enhancements" round's
 * 10-reason, differently-worded version of the same
 * InvoiceClaimLine.reasonCategory field (including a typo in that
 * round's item 7, "BarCode Scabbing Problem") -- see
 * lib/invoice-claims/validation.ts's own comment on
 * CLAIM_LINE_REASON_CATEGORIES/CLAIM_LINE_REASON_CATEGORY_LABELS for
 * how the 2 now-unlisted legacy values (PRODUCT_NOT_ORDERED,
 * PRODUCT_NOT_DELIVERED) are preserved for historical display only.
 */
describe("Management Analytics spec Part 4: CLAIM_LINE_REASON_CATEGORIES", () => {
  it("has exactly the 8 spec-named reasons, no more, no fewer", () => {
    expect(CLAIM_LINE_REASON_CATEGORIES).toHaveLength(8);
    expect(new Set(CLAIM_LINE_REASON_CATEGORIES).size).toBe(8); // no duplicates
  });

  it("is exactly the 8 spec reasons, in the spec's own exact order", () => {
    expect(CLAIM_LINE_REASON_CATEGORIES).toEqual([
      "PRICING_DISPUTE",
      "QUALITY_ISSUE",
      "SHORT_DELIVERY",
      "OVERSUPPLY",
      "EXPIRED_PRODUCT",
      "NO_BARCODE",
      "BARCODE_SCANNING_ISSUE",
      "DUPLICATE_ENTRY",
    ]);
  });

  it("no longer offers the 2 superseded, non-spec legacy reasons as selectable", () => {
    expect(CLAIM_LINE_REASON_CATEGORIES).not.toContain("PRODUCT_NOT_ORDERED");
    expect(CLAIM_LINE_REASON_CATEGORIES).not.toContain("PRODUCT_NOT_DELIVERED");
  });

  it("has a display label for every one of the 8 selectable categories", () => {
    for (const category of CLAIM_LINE_REASON_CATEGORIES) {
      expect(CLAIM_LINE_REASON_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  // Spec Part 4, verbatim: "EXACTLY these 8 standardised options, in
  // this exact order/wording" -- locked down so a future edit can't
  // silently drift from the required wording.
  it("uses the exact 8 standardised display labels from the spec, verbatim", () => {
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.PRICING_DISPUTE).toBe("Price Claim");
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.QUALITY_ISSUE).toBe("Poor Quality Product");
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.SHORT_DELIVERY).toBe("Short Delivered");
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.OVERSUPPLY).toBe("OverSupply");
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.EXPIRED_PRODUCT).toBe("Expire");
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.NO_BARCODE).toBe("No Barcode");
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.BARCODE_SCANNING_ISSUE).toBe("Barcode Scanning Problems");
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.DUPLICATE_ENTRY).toBe("Duplicates");
  });

  it("still carries a display label for the 2 superseded legacy reasons, for historical claim lines only", () => {
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.PRODUCT_NOT_ORDERED).toBeTruthy();
    expect(CLAIM_LINE_REASON_CATEGORY_LABELS.PRODUCT_NOT_DELIVERED).toBeTruthy();
  });

  it("claimLineInputSchema accepts a valid reasonCategory on both a QUANTITY and an AMOUNT_ONLY line", () => {
    expect(
      claimLineInputSchema.safeParse({
        sapInvoiceLineId: "line-1",
        disputeType: "QUANTITY",
        acceptedQuantity: "8",
        rejectedQuantity: "2",
        reason: "2 short",
        reasonCategory: "SHORT_DELIVERY",
      }).success
    ).toBe(true);
    expect(
      claimLineInputSchema.safeParse({
        sapInvoiceLineId: "line-1",
        disputeType: "AMOUNT_ONLY",
        disputedAmount: "10",
        reason: "Wrong price list applied",
        reasonCategory: "PRICING_DISPUTE",
      }).success
    ).toBe(true);
  });

  it("reasonCategory is optional (backward compatible with a caller that predates this field)", () => {
    expect(
      claimLineInputSchema.safeParse({
        sapInvoiceLineId: "line-1",
        disputeType: "QUANTITY",
        acceptedQuantity: "8",
        rejectedQuantity: "2",
        reason: "2 short",
      }).success
    ).toBe(true);
  });

  it("rejects a reasonCategory outside the 8 named values", () => {
    expect(
      claimLineInputSchema.safeParse({
        sapInvoiceLineId: "line-1",
        disputeType: "QUANTITY",
        acceptedQuantity: "8",
        rejectedQuantity: "2",
        reason: "2 short",
        reasonCategory: "SOMETHING_ELSE",
      }).success
    ).toBe(false);
  });

  // Regression guard: these 2 values were valid, selectable reasonCategory
  // input under the superseded 10-reason version of this field. Spec Part
  // 4 drops them from the selectable set (they are not among the 8 named
  // reasons), so new input using either must now be rejected -- even
  // though both remain valid, non-rejected *stored* values for a
  // historical claim line created before this change (see
  // CLAIM_LINE_REASON_CATEGORY_LABELS, which still carries their display
  // labels for that reason).
  it("rejects the 2 superseded legacy reasons as NEW input, even though they were valid before this change", () => {
    expect(
      claimLineInputSchema.safeParse({
        sapInvoiceLineId: "line-1",
        disputeType: "QUANTITY",
        acceptedQuantity: "8",
        rejectedQuantity: "2",
        reason: "Never ordered this product",
        reasonCategory: "PRODUCT_NOT_ORDERED",
      }).success
    ).toBe(false);
    expect(
      claimLineInputSchema.safeParse({
        sapInvoiceLineId: "line-1",
        disputeType: "QUANTITY",
        acceptedQuantity: "8",
        rejectedQuantity: "2",
        reason: "Never physically delivered",
        reasonCategory: "PRODUCT_NOT_DELIVERED",
      }).success
    ).toBe(false);
  });
});

/**
 * Real-world fix (native Invoice Claims): Willsgrove doesn't yet have
 * real reconciled SAP invoices, so a claim must be filable against this
 * business's own order/order-line data directly, with no SapInvoice in
 * the picture at all. These tests cover the two new, purely structural
 * rules this requires -- claimLineInputSchema's sapInvoiceLineId/
 * orderLineId XOR, and createInvoiceClaimSchema's matching header/line
 * linkage check -- without touching the database (both schemas, and
 * isNativeClaimInput, have no @prisma/client import).
 */
describe("Real-world fix (native Invoice Claims): claimLineInputSchema's sapInvoiceLineId/orderLineId XOR", () => {
  const base = {
    disputeType: "QUANTITY" as const,
    acceptedQuantity: "8",
    rejectedQuantity: "2",
    reason: "2 short",
  };

  it("accepts a line with only orderLineId set (a native claim line)", () => {
    expect(claimLineInputSchema.safeParse({ ...base, orderLineId: "order-line-1" }).success).toBe(true);
  });

  it("accepts a line with only sapInvoiceLineId set (the pre-existing SAP-anchored path)", () => {
    expect(claimLineInputSchema.safeParse({ ...base, sapInvoiceLineId: "sap-line-1" }).success).toBe(true);
  });

  it("rejects a line with neither sapInvoiceLineId nor orderLineId set", () => {
    expect(claimLineInputSchema.safeParse({ ...base }).success).toBe(false);
  });

  it("rejects a line with BOTH sapInvoiceLineId and orderLineId set -- a line never has dual linkage, unlike the claim header", () => {
    expect(
      claimLineInputSchema.safeParse({ ...base, sapInvoiceLineId: "sap-line-1", orderLineId: "order-line-1" }).success
    ).toBe(false);
  });

  it("also applies the XOR to an AMOUNT_ONLY line", () => {
    const amountOnlyBase = { disputeType: "AMOUNT_ONLY" as const, disputedAmount: "10", reason: "Wrong price" };
    expect(claimLineInputSchema.safeParse({ ...amountOnlyBase, orderLineId: "order-line-1" }).success).toBe(true);
    expect(claimLineInputSchema.safeParse({ ...amountOnlyBase }).success).toBe(false);
    expect(
      claimLineInputSchema.safeParse({ ...amountOnlyBase, sapInvoiceLineId: "sap-line-1", orderLineId: "order-line-1" })
        .success
    ).toBe(false);
  });
});

describe("Real-world fix (native Invoice Claims): createInvoiceClaimSchema's header/line linkage", () => {
  const header = {
    customerId: "customer-1",
    category: "SHORT_DELIVERY" as const,
    description: "3 cases short on delivery",
    claimDate: "2026-11-20",
  };

  it("accepts a fully native claim: orderId set, every line carries orderLineId, no sapInvoiceId at all", () => {
    const result = createInvoiceClaimSchema.safeParse({
      ...header,
      orderId: "order-1",
      lines: [
        { disputeType: "QUANTITY", orderLineId: "order-line-1", acceptedQuantity: "7", rejectedQuantity: "3", reason: "3 short" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the pre-existing SAP-anchored shape unchanged: sapInvoiceId set, every line carries sapInvoiceLineId", () => {
    const result = createInvoiceClaimSchema.safeParse({
      ...header,
      sapInvoiceId: "invoice-1",
      lines: [
        { disputeType: "QUANTITY", sapInvoiceLineId: "sap-line-1", acceptedQuantity: "7", rejectedQuantity: "3", reason: "3 short" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a claim with neither sapInvoiceId nor orderId set at the header level", () => {
    const result = createInvoiceClaimSchema.safeParse({
      ...header,
      lines: [
        { disputeType: "QUANTITY", orderLineId: "order-line-1", acceptedQuantity: "7", rejectedQuantity: "3", reason: "3 short" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a native (orderId-anchored) claim whose line uses sapInvoiceLineId instead of orderLineId -- header and line linkage must match", () => {
    const result = createInvoiceClaimSchema.safeParse({
      ...header,
      orderId: "order-1",
      lines: [
        { disputeType: "QUANTITY", sapInvoiceLineId: "sap-line-1", acceptedQuantity: "7", rejectedQuantity: "3", reason: "3 short" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a SAP-anchored claim whose line uses orderLineId instead of sapInvoiceLineId -- same mismatch, opposite direction", () => {
    const result = createInvoiceClaimSchema.safeParse({
      ...header,
      sapInvoiceId: "invoice-1",
      lines: [
        { disputeType: "QUANTITY", orderLineId: "order-line-1", acceptedQuantity: "7", rejectedQuantity: "3", reason: "3 short" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a claim with BOTH sapInvoiceId and orderId set (the pre-existing optional cross-reference case) as long as every line still uses sapInvoiceLineId", () => {
    // InvoiceClaim.orderId predates this round as an optional
    // cross-reference on a SAP-anchored claim ("where possible, the
    // original SalesFlow order") -- the header check only requires
    // sapInvoiceId's own branch to hold when sapInvoiceId is set, so
    // orderId may additionally be present without changing what the
    // lines must carry.
    const result = createInvoiceClaimSchema.safeParse({
      ...header,
      sapInvoiceId: "invoice-1",
      orderId: "order-1",
      lines: [
        { disputeType: "QUANTITY", sapInvoiceLineId: "sap-line-1", acceptedQuantity: "7", rejectedQuantity: "3", reason: "3 short" },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("Real-world fix (native Invoice Claims): isNativeClaimInput", () => {
  it("is true when sapInvoiceId is absent", () => {
    expect(isNativeClaimInput({ sapInvoiceId: undefined })).toBe(true);
  });

  it("is false when sapInvoiceId is set, even if orderId is also set", () => {
    expect(isNativeClaimInput({ sapInvoiceId: "invoice-1" })).toBe(false);
  });
});
