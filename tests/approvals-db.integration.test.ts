import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 8 (Validation and Approvals). DB-backed acceptance tests
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the same reason as every other *-db.integration
 * test in this project: @prisma/client in this sandbox is a stub that
 * THROWS when merely constructed (see docs/milestones/PROGRESS.md's
 * "Sandbox-only blocker"). Every lib touched here is imported with a
 * dynamic `await import(...)` inside the (skippable) test bodies below.
 * This means these tests have NOT been executed in this sandbox -- only
 * verified to typecheck/lint and to match every function signature read
 * directly from the source files they call (lib/approvals/requests.ts,
 * policies.ts, policy-queries.ts, quotation-gate.ts, lib/quotations/
 * create.ts, issue.ts, edit.ts). Written to the same standard as
 * tests/quotations-db.integration.test.ts, which this project has
 * previously run successfully outside this sandbox.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer must exist).
 *
 * This suite exercises the LIB layer directly (approveApprovalRequest,
 * rejectApprovalRequest, etc., called with an explicit decidedByRole
 * argument), the same way every other *-db.integration test in this
 * project calls its lib functions directly rather than through a real
 * HTTP request. That means it does not and cannot exercise "an
 * unauthenticated request is rejected" or "a direct API call without a
 * session is rejected" -- those are enforced by requireUserOrResponse()
 * at each approvals/approval-policies API route, outside
 * what a lib-level test can observe without standing up a real HTTP
 * server, which no existing test in this project does either. What this
 * suite DOES exercise, and what actually constitutes this feature's
 * security logic, is every rule enforced at the lib layer itself: a
 * requester or quotation preparer may never decide their own request
 * regardless of role (self-approval / separation-of-duties), a decider
 * whose role does not satisfy the request's requiredApproverRole is
 * refused regardless of session validity (role-eligibility), and only
 * the original requester may withdraw their own request (requester-only).
 *
 * Creates its own SALES_MANAGER test users directly via prisma.user.create
 * (isDemo: true) rather than depending on seeded roles beyond the one
 * ADMINISTRATOR account db:seed guarantees -- same reasoning as
 * tests/quotations-db.integration.test.ts building its own Product/
 * TaxCode rows instead of depending on a specific seeded catalogue item.
 *
 * Every row this test creates is marked isDemo: true where the model
 * supports it (createQuotation itself hardcodes isDemo: false on every
 * Quotation it creates, so quotations are cleaned up by explicit id,
 * exactly like tests/quotations-db.integration.test.ts does), and
 * cleaned up in afterAll in FK-respecting order.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 8: approvals", () => {
  let skipAll = false;

  let adminId: string;
  let managerAId: string; // creates/issues quotations in most scenarios (requester == preparer)
  let managerBId: string; // a second, unrelated SALES_MANAGER who decides them
  let customerId: string;
  let productId: string;
  const uniqueSuffix = `apr8test-${Date.now()}`;

  const createdQuotationIds: string[] = [];
  const createdPolicyIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdTaxCodeIds: string[] = [];

  async function createTestUser(roleSuffix: string, role: "SALES_MANAGER" | "ADMINISTRATOR") {
    const { prisma } = await import("@/lib/prisma");
    const user = await prisma.user.create({
      data: {
        name: `M8 Test ${roleSuffix}`,
        email: `${uniqueSuffix}-${roleSuffix}@example.invalid`,
        passwordHash: "not-a-real-hash-this-user-never-logs-in",
        role,
        status: "ACTIVE",
        mustChangePassword: false,
        isDemo: true,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 8 approvals DB integration test: need an admin user and the " +
          "DEMO-CUST-001 customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;

    managerAId = await createTestUser("manager-a", "SALES_MANAGER");
    managerBId = await createTestUser("manager-b", "SALES_MANAGER");

    const tax = await prisma.taxCode.create({
      data: { code: `VAT-${uniqueSuffix}`, description: "15% test VAT", ratePercent: "15.00", isDemo: true },
      select: { id: true },
    });
    createdTaxCodeIds.push(tax.id);

    const product = await prisma.product.create({
      data: { sapItemCode: `ITEM-${uniqueSuffix}`, itemName: "Milestone 8 test widget", unitOfMeasure: "EA", vatCode: `VAT-${uniqueSuffix}`, isDemo: true },
      select: { id: true },
    });
    createdProductIds.push(product.id);
    productId = product.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      // FK-respecting leaves-first order, mirroring
      // tests/quotations-db.integration.test.ts's own afterAll and
      // scripts/remove-demo-data.ts's Milestone 8 cleanup group:
      // ApprovalEvent before ApprovalRequest before ApprovalPolicy;
      // QuotationEvent/QuotationLine before Quotation; Notification
      // independently (no FK onto anything cleaned up here).
      await prisma.approvalEvent.deleteMany({ where: { approvalRequest: { requestedById: { in: [managerAId, managerBId].filter(Boolean) } } } });
      await prisma.approvalRequest.deleteMany({ where: { quotationId: { in: createdQuotationIds } } });
      await prisma.approvalPolicy.deleteMany({ where: { id: { in: createdPolicyIds } } });
      await prisma.quotationEvent.deleteMany({ where: { quotationId: { in: createdQuotationIds } } });
      await prisma.quotationLine.deleteMany({ where: { quotationId: { in: createdQuotationIds } } });
      await prisma.quotation.deleteMany({ where: { id: { in: createdQuotationIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.auditEvent.deleteMany({ where: { actorId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      await prisma.taxCode.deleteMany({ where: { id: { in: createdTaxCodeIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** A DRAFT quotation, prepared by `preparedById`, with one line at the given discount percent. */
  async function createTestQuotation(discountPercent: string, preparedById: string) {
    const { createQuotation } = await import("@/lib/quotations/create");
    const today = new Date().toISOString().slice(0, 10);
    const result = await createQuotation(
      {
        customerId,
        quotationDate: today,
        validUntil: today,
        currency: "USD",
        lines: [{ productId, quantity: "10", unitPrice: "100.00", discountPercent, isUnlistedItem: false }],
      } as never,
      preparedById
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`setup failed: createQuotation (${result.message})`);
    createdQuotationIds.push(result.id);
    return result.id;
  }

  describe("Policy A (10% threshold, SALES_MANAGER): full lifecycle", () => {
    let policyAId: string;

    beforeAll(async () => {
      if (skipAll) return;
      const { createApprovalPolicy } = await import("@/lib/approvals/policies");
      const result = await createApprovalPolicy(
        { actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", name: `M8 test: >10% (${uniqueSuffix})`, thresholdPercent: "10", requiredApproverRole: "SALES_MANAGER" },
        adminId,
        { isDemo: true }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`setup failed: createApprovalPolicy (${result.message})`);
      policyAId = result.id;
      createdPolicyIds.push(policyAId);
    });

    it("issuing a quotation whose discount exceeds the threshold is blocked (403) and creates exactly one PENDING request, leaving the quotation DRAFT", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { issueQuotation } = await import("@/lib/quotations/issue");

      const quotationId = await createTestQuotation("20", managerAId);
      const result = await issueQuotation(quotationId, managerAId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
      expect(result.approvalRequestId).toBeTruthy();

      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(quotation.status).toBe("DRAFT");

      const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalRequestId! } });
      expect(request.status).toBe("PENDING");
      expect(request.module).toBe("QUOTATIONS");
      expect(request.actionType).toBe("QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD");
      expect(request.requestedById).toBe(managerAId);
      expect(request.requiredApproverRole).toBe("SALES_MANAGER");
      expect(request.quotationId).toBe(quotationId);
      expect(request.customerOrderId).toBeNull();

      // Self-approval / separation-of-duties: the requester (managerA) is
      // also this quotation's preparer here, so either reason alone blocks.
      const { approveApprovalRequest } = await import("@/lib/approvals/requests");
      const selfApprove = await approveApprovalRequest(request.id, managerAId, "SALES_MANAGER", "trying to approve my own request");
      expect(selfApprove.ok).toBe(false);
      if (!selfApprove.ok) expect(selfApprove.status).toBe(403);

      // A different SALES_MANAGER, neither the requester nor the
      // preparer, may approve it.
      const approved = await approveApprovalRequest(request.id, managerBId, "SALES_MANAGER", "Within acceptable range for this customer");
      expect(approved.ok).toBe(true);

      const decided = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(decided.status).toBe("APPROVED");
      expect(decided.decidedById).toBe(managerBId);

      // Deciding an already-decided request again is refused (409), not
      // silently re-applied.
      const redecided = await approveApprovalRequest(request.id, managerBId, "SALES_MANAGER", "approving again");
      expect(redecided.ok).toBe(false);
      if (!redecided.ok) expect(redecided.status).toBe(409);

      // Re-issuing now succeeds -- the APPROVED request's snapshot still
      // matches the quotation's unchanged current values.
      const reissue = await issueQuotation(quotationId, managerAId);
      expect(reissue.ok).toBe(true);
      const issued = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(issued.status).toBe("ISSUED");
    });

    it("rejects with a mandatory reason and notifies the requester", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { issueQuotation } = await import("@/lib/quotations/issue");
      const { rejectApprovalRequest } = await import("@/lib/approvals/requests");

      const quotationId = await createTestQuotation("30", managerAId);
      const result = await issueQuotation(quotationId, managerAId);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      const rejected = await rejectApprovalRequest(result.approvalRequestId!, managerBId, "SALES_MANAGER", "Discount too deep for this customer's tier");
      expect(rejected.ok).toBe(true);

      const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalRequestId! } });
      expect(request.status).toBe("REJECTED");
      expect(request.decisionReason).toBe("Discount too deep for this customer's tier");

      const notification = await prisma.notification.findFirst({ where: { userId: managerAId, type: "APPROVAL_REJECTED" } });
      expect(notification).not.toBeNull();

      // REJECTED is terminal -- the quotation can never be re-issued
      // against this same (rejected) request; a fresh attempt would need
      // a brand-new submission, which this test does not need to chase.
      const stillDraft = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(stillDraft.status).toBe("DRAFT");
    });

    it("duplicate submission prevention: a second issue attempt on the same unchanged quotation returns 409 against the existing PENDING request, not a second one", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { issueQuotation } = await import("@/lib/quotations/issue");

      const quotationId = await createTestQuotation("25", managerAId);
      const first = await issueQuotation(quotationId, managerAId);
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.status).toBe(403);

      const second = await issueQuotation(quotationId, managerAId);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
      expect(second.approvalRequestId).toBe(first.approvalRequestId);

      const count = await prisma.approvalRequest.count({ where: { quotationId } });
      expect(count).toBe(1);
    });

    it("concurrent decisions on the same request: exactly one of two simultaneous decide calls succeeds, the other is refused with 409", async () => {
      if (skipAll) return;
      const { issueQuotation } = await import("@/lib/quotations/issue");
      const { approveApprovalRequest, rejectApprovalRequest } = await import("@/lib/approvals/requests");

      const quotationId = await createTestQuotation("40", managerAId);
      const submitted = await issueQuotation(quotationId, managerAId);
      expect(submitted.ok).toBe(false);
      if (submitted.ok) return;
      const requestId = submitted.approvalRequestId!;

      const [approveResult, rejectResult] = await Promise.all([
        approveApprovalRequest(requestId, managerBId, "SALES_MANAGER", "approving"),
        rejectApprovalRequest(requestId, managerBId, "SALES_MANAGER", "rejecting"),
      ]);

      const outcomes = [approveResult, rejectResult];
      const succeeded = outcomes.filter((r) => r.ok);
      const failed = outcomes.filter((r) => !r.ok);
      // The atomic `updateMany({where: {id, status: <pre-read status>}})`
      // guard in lib/approvals/requests.ts means at most one of these two
      // concurrent writes can match a still-PENDING row -- whichever loses
      // the race sees count === 0 and is turned into a 409, never a
      // silently-overwritten decision.
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      if (failed[0] && !failed[0].ok) expect(failed[0].status).toBe(409);
    });

    it("staleness: lowering the discount below the threshold while a request is PENDING auto-invalidates it, and the quotation can then be issued with no approval needed at all", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { issueQuotation } = await import("@/lib/quotations/issue");
      const { updateQuotationLine } = await import("@/lib/quotations/edit");

      const quotationId = await createTestQuotation("15", managerAId);
      const submitted = await issueQuotation(quotationId, managerAId);
      expect(submitted.ok).toBe(false);
      if (submitted.ok) return;
      const originalRequestId = submitted.approvalRequestId!;

      const line = await prisma.quotationLine.findFirstOrThrow({ where: { quotationId }, select: { id: true } });
      const edited = await updateQuotationLine(
        quotationId,
        line.id,
        { productId, quantity: "10", unitPrice: "100.00", discountPercent: "5", isUnlistedItem: false } as never,
        managerAId
      );
      expect(edited.ok).toBe(true);

      const invalidated = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: originalRequestId } });
      expect(invalidated.status).toBe("CANCELLED");
      const invalidatedEvent = await prisma.approvalEvent.findFirst({ where: { approvalRequestId: originalRequestId, eventType: "INVALIDATED" } });
      expect(invalidatedEvent).not.toBeNull();

      const reissue = await issueQuotation(quotationId, managerAId);
      expect(reissue.ok).toBe(true);
      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(quotation.status).toBe("ISSUED");
    });

    it("staleness + resubmission chain: raising the discount further while a request is PENDING invalidates it and the next issue attempt creates a fresh request pointing back to it", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { issueQuotation } = await import("@/lib/quotations/issue");
      const { updateQuotationLine } = await import("@/lib/quotations/edit");

      const quotationId = await createTestQuotation("15", managerAId);
      const first = await issueQuotation(quotationId, managerAId);
      expect(first.ok).toBe(false);
      if (first.ok) return;
      const firstRequestId = first.approvalRequestId!;

      const line = await prisma.quotationLine.findFirstOrThrow({ where: { quotationId }, select: { id: true } });
      const edited = await updateQuotationLine(
        quotationId,
        line.id,
        { productId, quantity: "10", unitPrice: "100.00", discountPercent: "35", isUnlistedItem: false } as never,
        managerAId
      );
      expect(edited.ok).toBe(true);

      const firstRequest = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: firstRequestId } });
      expect(firstRequest.status).toBe("CANCELLED");

      const second = await issueQuotation(quotationId, managerAId);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.approvalRequestId).not.toBe(firstRequestId);

      const secondRequest = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: second.approvalRequestId! } });
      expect(secondRequest.status).toBe("PENDING");
      expect(secondRequest.previousRequestId).toBe(firstRequestId);
      expect(secondRequest.rootRequestId).toBe(firstRequestId);

      const { approveApprovalRequest } = await import("@/lib/approvals/requests");
      const approved = await approveApprovalRequest(secondRequest.id, managerBId, "SALES_MANAGER", "Approved after re-review");
      expect(approved.ok).toBe(true);

      const reissue = await issueQuotation(quotationId, managerAId);
      expect(reissue.ok).toBe(true);
    });

    it("withdraw: only the original requester may withdraw their own PENDING request", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { issueQuotation } = await import("@/lib/quotations/issue");
      const { withdrawApprovalRequest } = await import("@/lib/approvals/requests");

      const quotationId = await createTestQuotation("20", managerAId);
      const submitted = await issueQuotation(quotationId, managerAId);
      expect(submitted.ok).toBe(false);
      if (submitted.ok) return;
      const requestId = submitted.approvalRequestId!;

      const wrongUser = await withdrawApprovalRequest(requestId, managerBId, "not my request");
      expect(wrongUser.ok).toBe(false);
      if (!wrongUser.ok) expect(wrongUser.status).toBe(403);

      const byRequester = await withdrawApprovalRequest(requestId, managerAId, "No longer needed");
      expect(byRequester.ok).toBe(true);

      const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(request.status).toBe("WITHDRAWN");
    });

    it("cancel: an administrator may cancel a live PENDING request with a mandatory reason", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { issueQuotation } = await import("@/lib/quotations/issue");
      const { cancelApprovalRequest } = await import("@/lib/approvals/requests");

      const quotationId = await createTestQuotation("20", managerAId);
      const submitted = await issueQuotation(quotationId, managerAId);
      expect(submitted.ok).toBe(false);
      if (submitted.ok) return;
      const requestId = submitted.approvalRequestId!;

      const cancelled = await cancelApprovalRequest(requestId, adminId, "Duplicate test entry, cancelling");
      expect(cancelled.ok).toBe(true);

      const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(request.status).toBe("CANCELLED");
      expect(request.cancelledById).toBe(adminId);
      expect(request.cancellationReason).toBe("Duplicate test entry, cancelling");
    });

    afterAll(async () => {
      if (skipAll) return;
      const { updateApprovalPolicy } = await import("@/lib/approvals/policies");
      await updateApprovalPolicy(policyAId, { active: false }, adminId);
    });
  });

  describe("Policy C (10% threshold, ADMINISTRATOR-only): role-eligibility", () => {
    let policyCId: string;

    beforeAll(async () => {
      if (skipAll) return;
      const { createApprovalPolicy } = await import("@/lib/approvals/policies");
      const result = await createApprovalPolicy(
        { actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", name: `M8 test: admin-only >10% (${uniqueSuffix})`, thresholdPercent: "10", requiredApproverRole: "ADMINISTRATOR" },
        adminId,
        { isDemo: true }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`setup failed: createApprovalPolicy (${result.message})`);
      policyCId = result.id;
      createdPolicyIds.push(policyCId);
    });

    it("a SALES_MANAGER decider is refused on a request that requires ADMINISTRATOR; an ADMINISTRATOR decider succeeds", async () => {
      if (skipAll) return;
      const { issueQuotation } = await import("@/lib/quotations/issue");
      const { approveApprovalRequest } = await import("@/lib/approvals/requests");

      const quotationId = await createTestQuotation("20", managerAId);
      const submitted = await issueQuotation(quotationId, managerAId);
      expect(submitted.ok).toBe(false);
      if (submitted.ok) return;
      const requestId = submitted.approvalRequestId!;

      const byManager = await approveApprovalRequest(requestId, managerBId, "SALES_MANAGER", "trying anyway");
      expect(byManager.ok).toBe(false);
      if (!byManager.ok) expect(byManager.status).toBe(403);

      const byAdmin = await approveApprovalRequest(requestId, adminId, "ADMINISTRATOR", "Administrator-level approval");
      expect(byAdmin.ok).toBe(true);
    });

    afterAll(async () => {
      if (skipAll) return;
      const { updateApprovalPolicy } = await import("@/lib/approvals/policies");
      await updateApprovalPolicy(policyCId, { active: false }, adminId);
    });
  });

  it("with no active policy at all, a quotation of any discount issues immediately with no approval request created", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { issueQuotation } = await import("@/lib/quotations/issue");

    // Both Policy A and Policy C deactivate themselves in their own
    // describe block's afterAll, which vitest runs before this top-level
    // `it` only if declaration order is respected; to avoid depending on
    // that ordering, explicitly confirm no policy of this actionType is
    // active before asserting the "ungated" behavior.
    const activeCount = await prisma.approvalPolicy.count({ where: { actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", active: true } });
    if (activeCount > 0) {
      console.log("Skipping 'no active policy' assertion: another active QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD policy exists outside this test's control.");
      return;
    }

    const quotationId = await createTestQuotation("90", managerAId);
    const result = await issueQuotation(quotationId, managerAId);
    expect(result.ok).toBe(true);

    const requestCount = await prisma.approvalRequest.count({ where: { quotationId } });
    expect(requestCount).toBe(0);
  });
});
