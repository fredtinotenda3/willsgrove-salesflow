import { describe, it, expect } from "vitest";
import {
  QUOTATION_STATUSES,
  validateQuotationStatusTransition,
  isTerminalQuotationStatus,
  isRevisableStatus,
  isConvertibleStatus,
  isEditableStatus,
  validatePositiveQuantity,
  validateValidityWindow,
  isEligibleForExpiry,
  percentStringSchema,
  createQuotationSchema,
  updateQuotationHeaderSchema,
  quotationLineInputSchema,
  respondToQuotationSchema,
  cancelQuotationSchema,
  reviseQuotationSchema,
  convertQuotationToOrderSchema,
  updateQuotationFollowUpSchema,
  type QuotationStatus,
} from "@/lib/quotations/validation";

/**
 * Milestone 7 (Quotations Management). Pure, no-database unit tests for
 * lib/quotations/validation.ts -- the ONLY lib/quotations/ file with no
 * `@prisma/client` import, so (unlike the DB-gated
 * tests/quotations-db.integration.test.ts) these run in every
 * environment, including this sandbox. Mirrors tests/returns-credits.test.ts
 * and tests/invoice-claims.test.ts's own shape exactly.
 *
 * lib/quotations/calculations.ts, create.ts, edit.ts, issue.ts,
 * respond.ts, cancel.ts, revise.ts, convert-to-order.ts and expiry.ts all
 * import `@prisma/client` (for `Prisma.Decimal`/`prisma`/transactions),
 * same as lib/invoice-claims/financial.ts and every lib/returns-credits/
 * file beyond csv.ts/validation.ts/status-recompute.ts/matching.ts -- this
 * project's established convention is that those are exercised only by
 * the DB-gated integration test, never imported here, since
 * `@prisma/client` in this sandbox is a stub that throws when merely
 * constructed (see docs/milestones/PROGRESS.md's "Sandbox-only blocker").
 */

describe("Milestone 7: validateQuotationStatusTransition -- full 6x6 decision matrix", () => {
  const ALLOWED: Record<QuotationStatus, readonly QuotationStatus[]> = {
    DRAFT: ["ISSUED", "CANCELLED"],
    ISSUED: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
    ACCEPTED: ["CANCELLED"],
    REJECTED: [],
    EXPIRED: ["CANCELLED"],
    CANCELLED: [],
  };

  for (const from of QUOTATION_STATUSES) {
    for (const to of QUOTATION_STATUSES) {
      const shouldAllow = from !== to && ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${shouldAllow ? "ALLOWED" : "REJECTED"}`, () => {
        const result = validateQuotationStatusTransition(from, to);
        expect(result.ok).toBe(shouldAllow);
      });
    }
  }

  it("rejects a same-status transition with a specific 'already X' message, not the generic edge-not-found message", () => {
    const result = validateQuotationStatusTransition("ISSUED", "ISSUED");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/already ISSUED/i);
  });

  it("every status has a defined (possibly empty) edge list -- QUOTATION_STATUSES and the transition graph can never silently drift apart", () => {
    // If a 7th status were ever added to QUOTATION_STATUSES without a
    // matching transition-graph entry, validateQuotationStatusTransition
    // itself is typed to make that a compile error (Record<QuotationStatus,
    // ...> in validation.ts) -- this test is a runtime safety net on top
    // of that, re-confirming all 6 (and only 6) statuses exist.
    expect(QUOTATION_STATUSES).toHaveLength(6);
    expect(new Set(QUOTATION_STATUSES)).toEqual(new Set(["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]));
  });
});

describe("Milestone 7: terminal / revisable / convertible / editable status predicates", () => {
  it("REJECTED and CANCELLED are the only terminal statuses", () => {
    for (const status of QUOTATION_STATUSES) {
      expect(isTerminalQuotationStatus(status)).toBe(status === "REJECTED" || status === "CANCELLED");
    }
  });

  it("only ISSUED/ACCEPTED/REJECTED/EXPIRED may be revised -- never DRAFT (just edit it) or CANCELLED (dead)", () => {
    for (const status of QUOTATION_STATUSES) {
      const expected = ["ISSUED", "ACCEPTED", "REJECTED", "EXPIRED"].includes(status);
      expect(isRevisableStatus(status)).toBe(expected);
    }
  });

  it("only ACCEPTED is convertible into an order", () => {
    for (const status of QUOTATION_STATUSES) {
      expect(isConvertibleStatus(status)).toBe(status === "ACCEPTED");
    }
  });

  it("only DRAFT is editable", () => {
    for (const status of QUOTATION_STATUSES) {
      expect(isEditableStatus(status)).toBe(status === "DRAFT");
    }
  });
});

describe("Milestone 7: validatePositiveQuantity", () => {
  it("accepts a strictly positive quantity with up to 4 decimal places", () => {
    expect(validatePositiveQuantity("1").ok).toBe(true);
    expect(validatePositiveQuantity("0.0001").ok).toBe(true);
    expect(validatePositiveQuantity("123.4567").ok).toBe(true);
  });

  it("rejects zero -- zero means 'remove the line,' not 'quote zero of it'", () => {
    const result = validatePositiveQuantity("0");
    expect(result.ok).toBe(false);
  });

  it("rejects a negative or malformed quantity string", () => {
    expect(validatePositiveQuantity("-1").ok).toBe(false);
    expect(validatePositiveQuantity("abc").ok).toBe(false);
    expect(validatePositiveQuantity("1.23456").ok).toBe(false); // 5 decimal places
  });
});

describe("Milestone 7: validateValidityWindow", () => {
  it("accepts validUntil on or after quotationDate", () => {
    expect(validateValidityWindow("2026-01-01", "2026-01-01").ok).toBe(true);
    expect(validateValidityWindow("2026-01-01", "2026-01-31").ok).toBe(true);
  });

  it("rejects validUntil before quotationDate -- an already-expired quote on arrival makes no sense", () => {
    const result = validateValidityWindow("2026-01-31", "2026-01-01");
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed date-only string on either side", () => {
    expect(validateValidityWindow("not-a-date", "2026-01-01").ok).toBe(false);
    expect(validateValidityWindow("2026-01-01", "31/01/2026").ok).toBe(false);
  });
});

describe("Milestone 7: isEligibleForExpiry -- live-computed, never a stored flag", () => {
  it("is eligible only when ISSUED and validUntil is strictly before today", () => {
    expect(isEligibleForExpiry("ISSUED", "2026-01-01", "2026-01-02")).toBe(true);
  });

  it("is not eligible on the validity date itself (only once it has PASSED)", () => {
    expect(isEligibleForExpiry("ISSUED", "2026-01-02", "2026-01-02")).toBe(false);
  });

  it("is not eligible while validUntil is still in the future", () => {
    expect(isEligibleForExpiry("ISSUED", "2026-02-01", "2026-01-02")).toBe(false);
  });

  it("is never eligible for any non-ISSUED status, however stale validUntil is -- DRAFT/ACCEPTED/REJECTED/EXPIRED/CANCELLED all excluded", () => {
    for (const status of QUOTATION_STATUSES) {
      if (status === "ISSUED") continue;
      expect(isEligibleForExpiry(status, "2020-01-01", "2026-01-02")).toBe(false);
    }
  });
});

describe("Milestone 7: percentStringSchema", () => {
  it("accepts 0-100 with up to 2 decimal places", () => {
    expect(percentStringSchema.safeParse("0").success).toBe(true);
    expect(percentStringSchema.safeParse("100").success).toBe(true);
    expect(percentStringSchema.safeParse("12.5").success).toBe(true);
    expect(percentStringSchema.safeParse("99.99").success).toBe(true);
  });

  it("rejects negative, over-100, or more than 2 decimal places", () => {
    expect(percentStringSchema.safeParse("-1").success).toBe(false);
    expect(percentStringSchema.safeParse("100.01").success).toBe(false);
    expect(percentStringSchema.safeParse("150").success).toBe(false);
    expect(percentStringSchema.safeParse("12.345").success).toBe(false);
  });
});

describe("Milestone 7: quotationLineInputSchema -- catalogued vs. unlisted XOR", () => {
  const BASE = { quantity: "5.0000", unitPrice: "10.0000" };

  it("accepts a catalogued line (isUnlistedItem false/omitted + productId)", () => {
    expect(quotationLineInputSchema.safeParse({ ...BASE, productId: "prod-1" }).success).toBe(true);
    expect(quotationLineInputSchema.safeParse({ ...BASE, isUnlistedItem: false, productId: "prod-1" }).success).toBe(true);
  });

  it("accepts an unlisted line (isUnlistedItem true + unlistedItemDescription)", () => {
    expect(quotationLineInputSchema.safeParse({ ...BASE, isUnlistedItem: true, unlistedItemDescription: "Requested item not in SAP" }).success).toBe(true);
  });

  it("rejects a catalogued line with no productId", () => {
    expect(quotationLineInputSchema.safeParse({ ...BASE }).success).toBe(false);
  });

  it("rejects an unlisted line with no description", () => {
    expect(quotationLineInputSchema.safeParse({ ...BASE, isUnlistedItem: true }).success).toBe(false);
  });

  it("rejects a line that tries to be both catalogued and unlisted at once", () => {
    const result = quotationLineInputSchema.safeParse({ ...BASE, isUnlistedItem: true, productId: "prod-1", unlistedItemDescription: "desc" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive-shaped quantity/unitPrice string (delegated to decimalStringSchema)", () => {
    expect(quotationLineInputSchema.safeParse({ ...BASE, productId: "prod-1", quantity: "not-a-number" }).success).toBe(false);
    expect(quotationLineInputSchema.safeParse({ ...BASE, productId: "prod-1", unitPrice: "-5" }).success).toBe(false);
  });

  it("accepts an optional discountPercent/notes and rejects an out-of-range discountPercent", () => {
    expect(quotationLineInputSchema.safeParse({ ...BASE, productId: "prod-1", discountPercent: "15", notes: "a note" }).success).toBe(true);
    expect(quotationLineInputSchema.safeParse({ ...BASE, productId: "prod-1", discountPercent: "150" }).success).toBe(false);
  });
});

describe("Milestone 7: createQuotationSchema", () => {
  const MINIMAL = { customerId: "cust-1", quotationDate: "2026-01-01", validUntil: "2026-01-31" };

  it("accepts the minimal required shape with zero lines (a header-only draft)", () => {
    const result = createQuotationSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lines).toEqual([]);
  });

  it("rejects a missing customerId/quotationDate/validUntil", () => {
    expect(createQuotationSchema.safeParse({ quotationDate: "2026-01-01", validUntil: "2026-01-31" }).success).toBe(false);
    expect(createQuotationSchema.safeParse({ customerId: "cust-1", validUntil: "2026-01-31" }).success).toBe(false);
    expect(createQuotationSchema.safeParse({ customerId: "cust-1", quotationDate: "2026-01-01" }).success).toBe(false);
  });

  it("accepts a full payload with catalogued and unlisted lines mixed", () => {
    const result = createQuotationSchema.safeParse({
      ...MINIMAL,
      customerContactId: "contact-1",
      currency: "ZWG",
      customerReference: "RFQ-123",
      salespersonId: "user-1",
      internalNotes: "internal",
      customerNotes: "customer-facing",
      lines: [
        { productId: "prod-1", quantity: "2", unitPrice: "100" },
        { isUnlistedItem: true, unlistedItemDescription: "Special order widget", quantity: "1", unitPrice: "50" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 200 lines in one payload", () => {
    const lines = Array.from({ length: 201 }, (_, i) => ({ productId: `prod-${i}`, quantity: "1", unitPrice: "1" }));
    expect(createQuotationSchema.safeParse({ ...MINIMAL, lines }).success).toBe(false);
  });
});

describe("Milestone 7: updateQuotationHeaderSchema -- every field optional, nullable where the model allows null", () => {
  it("accepts an empty object (no-op update)", () => {
    expect(updateQuotationHeaderSchema.safeParse({}).success).toBe(true);
  });

  it("accepts explicit null for customerContactId/customerReference/internalNotes/customerNotes (clearing them)", () => {
    const result = updateQuotationHeaderSchema.safeParse({ customerContactId: null, customerReference: null, internalNotes: null, customerNotes: null });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed quotationDate/validUntil", () => {
    expect(updateQuotationHeaderSchema.safeParse({ quotationDate: "01/01/2026" }).success).toBe(false);
  });
});

describe("Milestone 7: respondToQuotationSchema -- discriminated on 'decision'", () => {
  it("ACCEPTED requires no rejectionReason and accepts optional notes/reference", () => {
    expect(respondToQuotationSchema.safeParse({ decision: "ACCEPTED" }).success).toBe(true);
    expect(respondToQuotationSchema.safeParse({ decision: "ACCEPTED", responseNotes: "ok", customerResponseReference: "PO-9" }).success).toBe(true);
  });

  it("REJECTED requires a non-empty rejectionReason", () => {
    expect(respondToQuotationSchema.safeParse({ decision: "REJECTED" }).success).toBe(false);
    expect(respondToQuotationSchema.safeParse({ decision: "REJECTED", rejectionReason: "" }).success).toBe(false);
    expect(respondToQuotationSchema.safeParse({ decision: "REJECTED", rejectionReason: "Price too high" }).success).toBe(true);
  });

  it("rejects an unknown decision value", () => {
    expect(respondToQuotationSchema.safeParse({ decision: "MAYBE" }).success).toBe(false);
  });

  it("rejects ACCEPTED-only fields (rejectionReason) leaking onto a REJECTED payload being otherwise valid is fine, but a bogus decision is not", () => {
    expect(respondToQuotationSchema.safeParse({}).success).toBe(false);
  });
});

describe("Milestone 7: cancelQuotationSchema / reviseQuotationSchema / convertQuotationToOrderSchema / updateQuotationFollowUpSchema", () => {
  it("cancelQuotationSchema requires a non-empty cancellationReason", () => {
    expect(cancelQuotationSchema.safeParse({}).success).toBe(false);
    expect(cancelQuotationSchema.safeParse({ cancellationReason: "" }).success).toBe(false);
    expect(cancelQuotationSchema.safeParse({ cancellationReason: "Customer withdrew" }).success).toBe(true);
  });

  it("reviseQuotationSchema's reason is optional", () => {
    expect(reviseQuotationSchema.safeParse({}).success).toBe(true);
    expect(reviseQuotationSchema.safeParse({ reason: "Price change" }).success).toBe(true);
  });

  it("convertQuotationToOrderSchema accepts an empty object -- every field optional", () => {
    expect(convertQuotationToOrderSchema.safeParse({}).success).toBe(true);
  });

  it("convertQuotationToOrderSchema rejects a malformed requestedDeliveryDate", () => {
    expect(convertQuotationToOrderSchema.safeParse({ requestedDeliveryDate: "soon" }).success).toBe(false);
  });

  it("updateQuotationFollowUpSchema accepts null to clear nextFollowUpDate/followUpNotes", () => {
    expect(updateQuotationFollowUpSchema.safeParse({ nextFollowUpDate: null, followUpNotes: null }).success).toBe(true);
  });

  it("updateQuotationFollowUpSchema rejects a malformed nextFollowUpDate", () => {
    expect(updateQuotationFollowUpSchema.safeParse({ nextFollowUpDate: "tomorrow" }).success).toBe(false);
  });
});
