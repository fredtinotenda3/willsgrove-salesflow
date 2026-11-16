import { describe, it, expect } from "vitest";
import { INVOICE_DELIVERY_OUTCOMES, recordInvoiceDeliveryOutcomeSchema } from "@/lib/invoice-delivery/validation";

/**
 * Final Operational Enhancements (spec Part 5) -- the "central
 * requirement." Unit tests for lib/invoice-delivery/validation.ts's zod
 * schemas -- unconditional (no @prisma/client dependency anywhere in this
 * file's or validation.ts's import graph: it only pulls in
 * createInvoiceClaimSchema from lib/invoice-claims/validation.ts, which is
 * itself pure), same convention as tests/picking-validation.test.ts and
 * tests/invoice-claims.test.ts.
 */

describe("INVOICE_DELIVERY_OUTCOMES", () => {
  it("is exactly the two outcomes the spec names: No Claim and With Claim", () => {
    expect(INVOICE_DELIVERY_OUTCOMES).toEqual(["NO_CLAIM", "WITH_CLAIM"]);
  });
});

describe("recordInvoiceDeliveryOutcomeSchema", () => {
  it("accepts a minimal NO_CLAIM body with no optional fields", () => {
    expect(recordInvoiceDeliveryOutcomeSchema.safeParse({ outcome: "NO_CLAIM" }).success).toBe(true);
  });

  it("accepts a NO_CLAIM body with podReference and notes", () => {
    expect(
      recordInvoiceDeliveryOutcomeSchema.safeParse({ outcome: "NO_CLAIM", podReference: "POD-0012", notes: "Signed clean, no issues" })
        .success
    ).toBe(true);
  });

  it("rejects an overly long podReference or notes on NO_CLAIM", () => {
    expect(recordInvoiceDeliveryOutcomeSchema.safeParse({ outcome: "NO_CLAIM", podReference: "x".repeat(201) }).success).toBe(false);
    expect(recordInvoiceDeliveryOutcomeSchema.safeParse({ outcome: "NO_CLAIM", notes: "x".repeat(2001) }).success).toBe(false);
  });

  /**
   * "With Claim" must always carry at least one claim -- this is the
   * schema-level half of the spec's "one-or-more linked claims" wording;
   * the per-claim validation (customer resolution, line quantities, etc.)
   * is enforced at the lib layer (lib/invoice-delivery/record-outcome.ts),
   * not here.
   */
  it("rejects a WITH_CLAIM body with no claims array at all, and with an empty claims array", () => {
    expect(recordInvoiceDeliveryOutcomeSchema.safeParse({ outcome: "WITH_CLAIM" }).success).toBe(false);
    expect(recordInvoiceDeliveryOutcomeSchema.safeParse({ outcome: "WITH_CLAIM", claims: [] }).success).toBe(false);
  });

  it("accepts a WITH_CLAIM body with one minimal, valid claim (customerId omitted -- defaulted at the lib layer)", () => {
    const parsed = recordInvoiceDeliveryOutcomeSchema.safeParse({
      outcome: "WITH_CLAIM",
      claims: [
        {
          category: "DAMAGED_PRODUCTS",
          description: "2 crates arrived damaged",
          claimDate: "2026-11-01",
          lines: [
            { sapInvoiceLineId: "line-1", disputeType: "QUANTITY", acceptedQuantity: "8", rejectedQuantity: "2", reason: "2 damaged on arrival" },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a WITH_CLAIM body carrying an explicit customerId per claim", () => {
    const parsed = recordInvoiceDeliveryOutcomeSchema.safeParse({
      outcome: "WITH_CLAIM",
      claims: [
        {
          customerId: "cust-1",
          category: "SHORT_DELIVERY",
          description: "Short by 5 units",
          claimDate: "2026-11-01",
          lines: [{ sapInvoiceLineId: "line-1", disputeType: "QUANTITY", acceptedQuantity: "10", rejectedQuantity: "5", reason: "Short delivery" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a WITH_CLAIM body whose claim is missing sapInvoiceId... because the field does not exist on this schema at all", () => {
    // sapInvoiceId is deliberately omitted from deliveryClaimInputSchema
    // (lib/invoice-delivery/validation.ts's own comment: it is always
    // derived from the invoice whose delivery is being recorded, never
    // accepted from the request body) -- supplying it must not be
    // required, and must simply be ignored by zod's default
    // strip-unknown-keys behaviour rather than causing a parse failure.
    const parsed = recordInvoiceDeliveryOutcomeSchema.safeParse({
      outcome: "WITH_CLAIM",
      claims: [
        {
          sapInvoiceId: "should-be-ignored",
          category: "SHORT_DELIVERY",
          description: "Short by 5 units",
          claimDate: "2026-11-01",
          lines: [{ sapInvoiceLineId: "line-1", disputeType: "QUANTITY", acceptedQuantity: "10", rejectedQuantity: "5", reason: "Short delivery" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.outcome === "WITH_CLAIM") {
      expect((parsed.data.claims[0] as Record<string, unknown>).sapInvoiceId).toBeUndefined();
    }
  });

  it("rejects an outcome value outside NO_CLAIM/WITH_CLAIM", () => {
    expect(recordInvoiceDeliveryOutcomeSchema.safeParse({ outcome: "PARTIAL_CLAIM" }).success).toBe(false);
    expect(recordInvoiceDeliveryOutcomeSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a WITH_CLAIM claim missing a required field (e.g. description)", () => {
    const parsed = recordInvoiceDeliveryOutcomeSchema.safeParse({
      outcome: "WITH_CLAIM",
      claims: [
        {
          category: "SHORT_DELIVERY",
          claimDate: "2026-11-01",
          lines: [{ sapInvoiceLineId: "line-1", disputeType: "QUANTITY", acceptedQuantity: "10", rejectedQuantity: "5", reason: "Short delivery" }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts multiple claims in one WITH_CLAIM body -- 'one-or-more linked claims'", () => {
    const makeClaim = (n: number) => ({
      category: "SHORT_DELIVERY" as const,
      description: `Claim ${n}`,
      claimDate: "2026-11-01",
      lines: [{ sapInvoiceLineId: `line-${n}`, disputeType: "QUANTITY" as const, acceptedQuantity: "10", rejectedQuantity: "1", reason: `Reason ${n}` }],
    });
    const parsed = recordInvoiceDeliveryOutcomeSchema.safeParse({
      outcome: "WITH_CLAIM",
      claims: [makeClaim(1), makeClaim(2)],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.outcome === "WITH_CLAIM") {
      expect(parsed.data.claims).toHaveLength(2);
    }
  });
});
