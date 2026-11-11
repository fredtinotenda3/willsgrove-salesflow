import { describe, it, expect } from "vitest";
import {
  APPROVAL_REQUEST_STATUSES,
  validateApprovalStatusTransition,
  isDecidedStatus,
  isLiveStatus,
  validateApprovalTargetRef,
  canDecideOwnRequest,
  eligibleApproverRoles,
  actionTypeModule,
  evaluateQuotationDiscountPolicies,
  snapshotsMatch,
  decideApprovalRequestSchema,
  rejectApprovalRequestSchema,
  withdrawApprovalRequestSchema,
  cancelApprovalRequestSchema,
  createApprovalPolicySchema,
  updateApprovalPolicySchema,
  listApprovalsQuerySchema,
  type ApprovalRequestStatus,
  type QuotationApprovalSnapshot,
  type ThresholdPolicyLike,
} from "@/lib/approvals/validation";

/**
 * Milestone 8 (Validation and Approvals). Pure, no-database unit tests
 * for lib/approvals/validation.ts -- the ONLY lib/approvals/ file with
 * no `@prisma/client` import, so (unlike the DB-gated
 * tests/approvals-db.integration.test.ts) these run in every
 * environment, including this sandbox. Mirrors tests/quotations.test.ts
 * and tests/invoice-claims.test.ts's own shape exactly.
 */

function snapshot(overrides: Partial<QuotationApprovalSnapshot> = {}): QuotationApprovalSnapshot {
  return {
    maxDiscountPercent: "10.0000",
    subtotal: "1000.0000",
    discountTotal: "100.0000",
    vatTotal: "135.0000",
    total: "1035.0000",
    currency: "USD",
    lineCount: 2,
    ...overrides,
  };
}

describe("Milestone 8: validateApprovalStatusTransition -- full 6x6 decision matrix", () => {
  const ALLOWED: Record<ApprovalRequestStatus, readonly ApprovalRequestStatus[]> = {
    DRAFT: ["PENDING", "CANCELLED", "WITHDRAWN"],
    PENDING: ["APPROVED", "REJECTED", "CANCELLED", "WITHDRAWN"],
    APPROVED: [],
    REJECTED: [],
    CANCELLED: [],
    WITHDRAWN: [],
  };

  for (const from of APPROVAL_REQUEST_STATUSES) {
    for (const to of APPROVAL_REQUEST_STATUSES) {
      const shouldAllow = from !== to && ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${shouldAllow ? "ALLOWED" : "REJECTED"}`, () => {
        const result = validateApprovalStatusTransition(from, to);
        expect(result.ok).toBe(shouldAllow);
      });
    }
  }

  it("rejects a same-status transition with a specific 'already X' message, not the generic edge-not-found message", () => {
    const result = validateApprovalStatusTransition("PENDING", "PENDING");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/already PENDING/i);
  });

  it("every status has a defined (possibly empty) edge list -- APPROVAL_REQUEST_STATUSES and the transition graph can never silently drift apart", () => {
    expect(APPROVAL_REQUEST_STATUSES).toHaveLength(6);
    expect(new Set(APPROVAL_REQUEST_STATUSES)).toEqual(new Set(["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED", "WITHDRAWN"]));
  });
});

describe("Milestone 8: isDecidedStatus / isLiveStatus predicates", () => {
  it("APPROVED and REJECTED are the only decided statuses", () => {
    for (const status of APPROVAL_REQUEST_STATUSES) {
      expect(isDecidedStatus(status)).toBe(status === "APPROVED" || status === "REJECTED");
    }
  });

  it("DRAFT and PENDING are the only live statuses -- every terminal status (including CANCELLED/WITHDRAWN) is not live", () => {
    for (const status of APPROVAL_REQUEST_STATUSES) {
      expect(isLiveStatus(status)).toBe(status === "DRAFT" || status === "PENDING");
    }
  });
});

describe("Milestone 8: actionTypeModule -- exhaustive actionType -> module mapping", () => {
  it("maps QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD to QUOTATIONS and ORDER_VALUE_EXCEEDS_THRESHOLD to ORDERS", () => {
    expect(actionTypeModule("QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD")).toBe("QUOTATIONS");
    expect(actionTypeModule("ORDER_VALUE_EXCEEDS_THRESHOLD")).toBe("ORDERS");
  });
});

describe("Milestone 8: validateApprovalTargetRef -- the typed-FK XOR integrity check", () => {
  it("accepts a QUOTATIONS request with only quotationId set", () => {
    expect(validateApprovalTargetRef("QUOTATIONS", { quotationId: "quo-1", customerOrderId: null }).ok).toBe(true);
  });

  it("accepts an ORDERS request with only customerOrderId set", () => {
    expect(validateApprovalTargetRef("ORDERS", { quotationId: null, customerOrderId: "ord-1" }).ok).toBe(true);
  });

  it("rejects a request with neither reference set", () => {
    expect(validateApprovalTargetRef("QUOTATIONS", {}).ok).toBe(false);
  });

  it("rejects a request with BOTH references set at once", () => {
    expect(validateApprovalTargetRef("QUOTATIONS", { quotationId: "quo-1", customerOrderId: "ord-1" }).ok).toBe(false);
  });

  it("rejects a QUOTATIONS request whose one set reference is customerOrderId (module/reference mismatch)", () => {
    expect(validateApprovalTargetRef("QUOTATIONS", { customerOrderId: "ord-1" }).ok).toBe(false);
  });

  it("rejects an ORDERS request whose one set reference is quotationId (module/reference mismatch)", () => {
    expect(validateApprovalTargetRef("ORDERS", { quotationId: "quo-1" }).ok).toBe(false);
  });
});

describe("Milestone 8: canDecideOwnRequest / eligibleApproverRoles", () => {
  it("canDecideOwnRequest is true only when the decider's id is among the blocked ids (requester and/or preparer)", () => {
    expect(canDecideOwnRequest("user-1", ["user-1", "user-2"])).toBe(true);
    expect(canDecideOwnRequest("user-3", ["user-1", "user-2"])).toBe(false);
    expect(canDecideOwnRequest("user-1", [])).toBe(false);
  });

  it("eligibleApproverRoles(SALES_MANAGER) allows SALES_MANAGER and ADMINISTRATOR", () => {
    expect(eligibleApproverRoles("SALES_MANAGER")).toEqual(["SALES_MANAGER", "ADMINISTRATOR"]);
  });

  it("eligibleApproverRoles(ADMINISTRATOR) allows only ADMINISTRATOR -- a SALES_MANAGER may never decide an administrator-only request", () => {
    expect(eligibleApproverRoles("ADMINISTRATOR")).toEqual(["ADMINISTRATOR"]);
  });
});

describe("Milestone 8: evaluateQuotationDiscountPolicies", () => {
  function policy(overrides: Partial<ThresholdPolicyLike> = {}): ThresholdPolicyLike {
    return { id: "pol-1", actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", thresholdPercent: "15.0000", requiredApproverRole: "SALES_MANAGER", ...overrides };
  }

  it("returns null when no policy is supplied -- a quotation is never gated by an absent rule", () => {
    expect(evaluateQuotationDiscountPolicies([], snapshot({ maxDiscountPercent: "50.0000" }))).toBeNull();
  });

  it("returns null when the quotation's max discount does not exceed the threshold (strictly-exceeds semantics, not >=)", () => {
    const result = evaluateQuotationDiscountPolicies([policy({ thresholdPercent: "15.0000" })], snapshot({ maxDiscountPercent: "15.0000" }));
    expect(result).toBeNull();
  });

  it("fires when the quotation's max discount strictly exceeds the threshold", () => {
    const result = evaluateQuotationDiscountPolicies([policy({ thresholdPercent: "15.0000" })], snapshot({ maxDiscountPercent: "15.0001" }));
    expect(result?.id).toBe("pol-1");
  });

  it("the most restrictive (lowest) firing threshold wins when more than one active policy could fire", () => {
    const lenient = policy({ id: "lenient", thresholdPercent: "20.0000" });
    const strict = policy({ id: "strict", thresholdPercent: "10.0000" });
    const result = evaluateQuotationDiscountPolicies([lenient, strict], snapshot({ maxDiscountPercent: "25.0000" }));
    expect(result?.id).toBe("strict");
  });

  it("a non-firing lenient policy does not mask a firing strict one regardless of array order", () => {
    const nonFiring = policy({ id: "non-firing", thresholdPercent: "30.0000" });
    const firing = policy({ id: "firing", thresholdPercent: "10.0000" });
    expect(evaluateQuotationDiscountPolicies([nonFiring, firing], snapshot({ maxDiscountPercent: "15.0000" }))?.id).toBe("firing");
    expect(evaluateQuotationDiscountPolicies([firing, nonFiring], snapshot({ maxDiscountPercent: "15.0000" }))?.id).toBe("firing");
  });

  it("ignores a policy of the wrong actionType or with a null thresholdPercent", () => {
    const wrongType = policy({ id: "wrong-type", actionType: "ORDER_VALUE_EXCEEDS_THRESHOLD", thresholdPercent: null });
    const nullThreshold = policy({ id: "null-threshold", thresholdPercent: null });
    expect(evaluateQuotationDiscountPolicies([wrongType, nullThreshold], snapshot({ maxDiscountPercent: "90.0000" }))).toBeNull();
  });

  it("treats a zero/absent discount (no line discounted) as never firing", () => {
    expect(evaluateQuotationDiscountPolicies([policy({ thresholdPercent: "0.0000" })], snapshot({ maxDiscountPercent: "0.0000" }))).toBeNull();
  });
});

describe("Milestone 8: snapshotsMatch -- exact-match comparison, never fuzzy", () => {
  it("matches two snapshots with identical values", () => {
    expect(snapshotsMatch(snapshot(), snapshot())).toBe(true);
  });

  it("does not match when any single field differs (total, discount, currency, or line count)", () => {
    expect(snapshotsMatch(snapshot(), snapshot({ total: "1035.0001" }))).toBe(false);
    expect(snapshotsMatch(snapshot(), snapshot({ maxDiscountPercent: "10.0001" }))).toBe(false);
    expect(snapshotsMatch(snapshot(), snapshot({ currency: "ZWG" }))).toBe(false);
    expect(snapshotsMatch(snapshot(), snapshot({ lineCount: 3 }))).toBe(false);
  });
});

describe("Milestone 8: decideApprovalRequestSchema / rejectApprovalRequestSchema / withdrawApprovalRequestSchema / cancelApprovalRequestSchema", () => {
  it("decideApprovalRequestSchema (used by approve) accepts an empty object -- a reason is optional to approve", () => {
    expect(decideApprovalRequestSchema.safeParse({}).success).toBe(true);
    expect(decideApprovalRequestSchema.safeParse({ decisionReason: "Within policy" }).success).toBe(true);
  });

  it("rejectApprovalRequestSchema requires a non-empty decisionReason", () => {
    expect(rejectApprovalRequestSchema.safeParse({}).success).toBe(false);
    expect(rejectApprovalRequestSchema.safeParse({ decisionReason: "" }).success).toBe(false);
    expect(rejectApprovalRequestSchema.safeParse({ decisionReason: "Discount too deep for this customer" }).success).toBe(true);
  });

  it("withdrawApprovalRequestSchema's reason is optional", () => {
    expect(withdrawApprovalRequestSchema.safeParse({}).success).toBe(true);
    expect(withdrawApprovalRequestSchema.safeParse({ decisionReason: "No longer needed" }).success).toBe(true);
  });

  it("cancelApprovalRequestSchema requires a non-empty cancellationReason", () => {
    expect(cancelApprovalRequestSchema.safeParse({}).success).toBe(false);
    expect(cancelApprovalRequestSchema.safeParse({ cancellationReason: "" }).success).toBe(false);
    expect(cancelApprovalRequestSchema.safeParse({ cancellationReason: "Duplicate submission" }).success).toBe(true);
  });
});

describe("Milestone 8: createApprovalPolicySchema -- discriminated on actionType", () => {
  it("accepts a valid QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD policy with thresholdPercent", () => {
    const result = createApprovalPolicySchema.safeParse({
      actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD",
      name: "Discounts over 15%",
      thresholdPercent: "15",
      requiredApproverRole: "SALES_MANAGER",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD policy with no thresholdPercent", () => {
    expect(
      createApprovalPolicySchema.safeParse({ actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", name: "Bad", requiredApproverRole: "SALES_MANAGER" }).success
    ).toBe(false);
  });

  it("rejects an out-of-range thresholdPercent (over 100 or negative)", () => {
    expect(
      createApprovalPolicySchema.safeParse({ actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", name: "Bad", thresholdPercent: "150", requiredApproverRole: "SALES_MANAGER" }).success
    ).toBe(false);
    expect(
      createApprovalPolicySchema.safeParse({ actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", name: "Bad", thresholdPercent: "-5", requiredApproverRole: "SALES_MANAGER" }).success
    ).toBe(false);
  });

  it("accepts a valid ORDER_VALUE_EXCEEDS_THRESHOLD policy with thresholdAmount and currency", () => {
    const result = createApprovalPolicySchema.safeParse({
      actionType: "ORDER_VALUE_EXCEEDS_THRESHOLD",
      name: "Orders over 50000 USD",
      thresholdAmount: "50000.0000",
      currency: "USD",
      requiredApproverRole: "ADMINISTRATOR",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an ORDER_VALUE_EXCEEDS_THRESHOLD policy missing currency", () => {
    expect(
      createApprovalPolicySchema.safeParse({ actionType: "ORDER_VALUE_EXCEEDS_THRESHOLD", name: "Bad", thresholdAmount: "50000.0000", requiredApproverRole: "ADMINISTRATOR" }).success
    ).toBe(false);
  });

  it("rejects an unrecognized actionType -- the discriminated union has exactly two members", () => {
    expect(createApprovalPolicySchema.safeParse({ actionType: "SOMETHING_ELSE", name: "Bad" }).success).toBe(false);
  });

  it("rejects an invalid requiredApproverRole", () => {
    expect(
      createApprovalPolicySchema.safeParse({ actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", name: "Bad", thresholdPercent: "15", requiredApproverRole: "SALESPERSON" }).success
    ).toBe(false);
  });

  it("rejects effectiveFrom/effectiveTo not shaped as YYYY-MM-DD", () => {
    expect(
      createApprovalPolicySchema.safeParse({
        actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD",
        name: "Bad",
        thresholdPercent: "15",
        requiredApproverRole: "SALES_MANAGER",
        effectiveFrom: "01/01/2026",
      }).success
    ).toBe(false);
  });
});

describe("Milestone 8: updateApprovalPolicySchema -- every field optional, nullable where the model allows null", () => {
  it("accepts an empty object (no-op update)", () => {
    expect(updateApprovalPolicySchema.safeParse({}).success).toBe(true);
  });

  it("accepts explicit null for overdueAfterHours/effectiveFrom/effectiveTo (clearing them)", () => {
    expect(updateApprovalPolicySchema.safeParse({ overdueAfterHours: null, effectiveFrom: null, effectiveTo: null }).success).toBe(true);
  });

  it("accepts toggling active alone", () => {
    expect(updateApprovalPolicySchema.safeParse({ active: false }).success).toBe(true);
  });

  it("rejects a non-positive overdueAfterHours", () => {
    expect(updateApprovalPolicySchema.safeParse({ overdueAfterHours: 0 }).success).toBe(false);
    expect(updateApprovalPolicySchema.safeParse({ overdueAfterHours: -1 }).success).toBe(false);
  });
});

describe("Milestone 8: listApprovalsQuerySchema", () => {
  it("accepts an empty query (no filters)", () => {
    expect(listApprovalsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts every documented filter together", () => {
    const result = listApprovalsQuerySchema.safeParse({
      module: "QUOTATIONS",
      actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD",
      status: "PENDING",
      requestedById: "user-1",
      decidedById: "user-2",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      currency: "USD",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid module/actionType/status enum value", () => {
    expect(listApprovalsQuerySchema.safeParse({ module: "INVOICES" }).success).toBe(false);
    expect(listApprovalsQuerySchema.safeParse({ actionType: "SOMETHING_ELSE" }).success).toBe(false);
    expect(listApprovalsQuerySchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(false);
  });

  it("rejects a malformed dateFrom/dateTo", () => {
    expect(listApprovalsQuerySchema.safeParse({ dateFrom: "Jan 1 2026" }).success).toBe(false);
  });
});
