import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 15 (Decision Intelligence). DB-backed acceptance tests for
 * lib/reporting/decision-intelligence-queries.ts, against a REAL
 * database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project (@prisma/client-stub sandbox
 * limitation):
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an ADMINISTRATOR user must
 * exist).
 *
 * IMPORTANT DEVIATION FROM EVERY OTHER *-db.integration TEST IN THIS
 * PROJECT: this file's own fixtures (the CreditNote rows it creates to
 * trigger COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY) are created with
 * `isDemo: false`, not `isDemo: true`. This is deliberate, not an
 * oversight: lib/reporting/decision-intelligence-queries.ts's own
 * generation step (evaluateAndSyncDecisionRecommendations ->
 * fetchDecisionRuleRawInputs) ALWAYS forces `includeDemo: false`
 * regardless of the caller's filters (see that file's own header
 * comment -- DecisionRecommendation rows are persisted and shared, so
 * demo data must never seed one). A demo-flagged CreditNote fixture
 * would therefore be invisible to the rule engine and this file's main
 * scenarios could never be exercised. Because these fixtures are not
 * demo-flagged, `scripts/remove-demo-data.ts` would never sweep them
 * up either, so this file deletes exactly what it creates in afterAll
 * regardless of outcome, using a synthetic, non-real currency code
 * ("T15"/"T15D") so it can never collide with real exposure data and is
 * trivially safe to delete.
 *
 * Coverage:
 *   - evaluateAndSyncDecisionRecommendations creates a new
 *     DecisionRecommendation + a CREATED DecisionRecommendationEvent on
 *     first evaluation, and the exact same row (never a duplicate) on
 *     re-evaluation -- spec section 5's stable-identity/no-uncontrolled-
 *     duplicates requirement.
 *   - updateDecisionRecommendationStatus: the full lifecycle (OPEN ->
 *     ACKNOWLEDGED -> RESOLVED -> OPEN/reopened), a rejected self-
 *     transition, and a rejected illegal transition (RESOLVED straight
 *     to ACKNOWLEDGED) -- every change recorded as its own history
 *     event, never overwritten.
 *   - Regeneration after a status change never resets status/history
 *     (the UPDATE path in syncDecisionRecommendations never touches
 *     lifecycle fields).
 *   - getDecisionRecommendationDetail returns the full evidence and the
 *     complete, ordered history.
 *   - listDecisionRecommendations / getDecisionIntelligenceOverview
 *     surface the created recommendation under the expected filters.
 *   - THE DEMO-EXCLUSION RULE ITSELF: an isDemo:true CreditNote fixture,
 *     even with includeDemo:true explicitly requested, never produces a
 *     DecisionRecommendation row.
 *
 * Deliberately NOT re-covered here (already proven elsewhere): the
 * underlying M12-M14 calculations each rule's raw-input fetcher
 * composes (customer/product revenue, attribution, lost sales, claims,
 * approvals, etc.) -- this file's job is only the NEW engine on top of
 * them (rule evaluation, persistence, lifecycle, demo exclusion), not
 * re-deriving calculations M12-M14's own DB integration tests already
 * prove.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

function emptyDecisionFilters(overrides: Record<string, unknown> = {}) {
  return {
    dateFrom: null,
    dateTo: null,
    customerId: null,
    productId: null,
    salespersonId: null,
    orderStatus: null,
    quotationStatus: null,
    fulfilmentStatus: null,
    claimStatus: null,
    communicationStatus: null,
    currency: null,
    lostSalesReason: null,
    includeDemo: false,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
    ...overrides,
  };
}

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 15: decision intelligence", () => {
  let skipAll = false;
  let adminId: string;
  const uniqueSuffix = `m15test-${Date.now()}`;
  const CURRENCY = "T15";
  const DEMO_CURRENCY = "T15D";
  const DEDUPE_KEY = `COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY::${CURRENCY}`;
  const DEMO_DEDUPE_KEY = `COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY::${DEMO_CURRENCY}`;

  const createdCreditNoteIds: string[] = [];
  let recommendationId: string | null = null;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    if (!admin) {
      console.log("Skipping Milestone 15 decision-intelligence DB integration test: need an ADMINISTRATOR user. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1.");
      skipAll = true;
      return;
    }
    adminId = admin.id;

    // Two non-demo, UNMATCHED credit notes in a synthetic currency --
    // clears the COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY count floor
    // of 2 (priority stays MEDIUM, since 2 < the HIGH floor of 5).
    const n1 = await prisma.creditNote.create({
      data: { sapCreditNoteDocNum: `${uniqueSuffix}-1`, currencyCode: CURRENCY, amount: "600.0000", matchStatus: "UNMATCHED", recordedById: adminId, isDemo: false },
      select: { id: true },
    });
    const n2 = await prisma.creditNote.create({
      data: { sapCreditNoteDocNum: `${uniqueSuffix}-2`, currencyCode: CURRENCY, amount: "450.0000", matchStatus: "UNMATCHED", recordedById: adminId, isDemo: false },
      select: { id: true },
    });
    createdCreditNoteIds.push(n1.id, n2.id);

    // One isDemo:true credit note in a SEPARATE synthetic currency, used
    // only by the demo-exclusion test below.
    const demoNote = await prisma.creditNote.create({
      data: { sapCreditNoteDocNum: `${uniqueSuffix}-demo`, currencyCode: DEMO_CURRENCY, amount: "900.0000", matchStatus: "UNMATCHED", recordedById: adminId, isDemo: true },
      select: { id: true },
    });
    createdCreditNoteIds.push(demoNote.id);
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    if (recommendationId) {
      await prisma.decisionRecommendationEvent.deleteMany({ where: { decisionRecommendationId: recommendationId } });
      await prisma.decisionRecommendation.deleteMany({ where: { id: recommendationId } });
    }
    // Defensive: also sweep by dedupeKey in case a test created the row
    // under a different id than the one captured (should not happen,
    // but cleanup must never leave a row behind on an unexpected path).
    const stray = await prisma.decisionRecommendation.findMany({ where: { dedupeKey: { in: [DEDUPE_KEY, DEMO_DEDUPE_KEY] } }, select: { id: true } });
    if (stray.length > 0) {
      await prisma.decisionRecommendationEvent.deleteMany({ where: { decisionRecommendationId: { in: stray.map((r) => r.id) } } });
      await prisma.decisionRecommendation.deleteMany({ where: { id: { in: stray.map((r) => r.id) } } });
    }
    if (createdCreditNoteIds.length > 0) {
      await prisma.creditNote.deleteMany({ where: { id: { in: createdCreditNoteIds } } });
    }
  });

  describe("evaluateAndSyncDecisionRecommendations: create + dedupe on regeneration", () => {
    it("creates a new DecisionRecommendation and a CREATED history event on first evaluation", async () => {
      if (skipAll) return;
      const { evaluateAndSyncDecisionRecommendations } = await import("@/lib/reporting/decision-intelligence-queries");
      const { prisma } = await import("@/lib/prisma");

      const { candidates } = await evaluateAndSyncDecisionRecommendations(emptyDecisionFilters({ currency: CURRENCY }), { id: adminId, role: "ADMINISTRATOR" });
      const ours = candidates.find((c) => c.dedupeKey === DEDUPE_KEY);
      expect(ours).toBeDefined();
      expect(ours!.priority).toBe("MEDIUM");

      const row = await prisma.decisionRecommendation.findUnique({ where: { dedupeKey: DEDUPE_KEY } });
      expect(row).not.toBeNull();
      expect(row!.status).toBe("OPEN");
      expect(row!.isDemo).toBe(false);
      recommendationId = row!.id;

      const events = await prisma.decisionRecommendationEvent.findMany({ where: { decisionRecommendationId: row!.id } });
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("CREATED");
      expect(events[0].toStatus).toBe("OPEN");
    });

    it("re-evaluation UPDATES the same row (never a duplicate) and never creates a second CREATED event", async () => {
      if (skipAll || !recommendationId) return;
      const { evaluateAndSyncDecisionRecommendations } = await import("@/lib/reporting/decision-intelligence-queries");
      const { prisma } = await import("@/lib/prisma");

      const before = await prisma.decisionRecommendation.findUnique({ where: { id: recommendationId }, select: { id: true, lastEvaluatedAt: true } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await evaluateAndSyncDecisionRecommendations(emptyDecisionFilters({ currency: CURRENCY }), { id: adminId, role: "ADMINISTRATOR" });

      const rows = await prisma.decisionRecommendation.findMany({ where: { dedupeKey: DEDUPE_KEY } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(recommendationId);
      expect(rows[0].lastEvaluatedAt.getTime()).toBeGreaterThan(before!.lastEvaluatedAt.getTime());

      const events = await prisma.decisionRecommendationEvent.findMany({ where: { decisionRecommendationId: recommendationId } });
      expect(events).toHaveLength(1);
    });
  });

  describe("updateDecisionRecommendationStatus: lifecycle transitions and history", () => {
    it("rejects a self-transition (OPEN -> OPEN)", async () => {
      if (skipAll || !recommendationId) return;
      const { updateDecisionRecommendationStatus } = await import("@/lib/reporting/decision-intelligence-queries");
      const result = await updateDecisionRecommendationStatus(recommendationId, "OPEN", adminId, null);
      expect(result.ok).toBe(false);
    });

    it("allows OPEN -> ACKNOWLEDGED, recording a new history event and the actor/note", async () => {
      if (skipAll || !recommendationId) return;
      const { updateDecisionRecommendationStatus } = await import("@/lib/reporting/decision-intelligence-queries");
      const { prisma } = await import("@/lib/prisma");

      const result = await updateDecisionRecommendationStatus(recommendationId, "ACKNOWLEDGED", adminId, "Reviewing with finance.");
      expect(result.ok).toBe(true);

      const row = await prisma.decisionRecommendation.findUnique({ where: { id: recommendationId } });
      expect(row!.status).toBe("ACKNOWLEDGED");
      expect(row!.statusNote).toBe("Reviewing with finance.");
      expect(row!.statusById).toBe(adminId);
      expect(row!.resolvedAt).toBeNull();

      const events = await prisma.decisionRecommendationEvent.findMany({ where: { decisionRecommendationId: recommendationId }, orderBy: { createdAt: "asc" } });
      expect(events).toHaveLength(2);
      expect(events[1].eventType).toBe("ACKNOWLEDGED");
      expect(events[1].fromStatus).toBe("OPEN");
      expect(events[1].toStatus).toBe("ACKNOWLEDGED");
      expect(events[1].actorId).toBe(adminId);
    });

    it("allows ACKNOWLEDGED -> RESOLVED, setting resolvedAt", async () => {
      if (skipAll || !recommendationId) return;
      const { updateDecisionRecommendationStatus } = await import("@/lib/reporting/decision-intelligence-queries");
      const { prisma } = await import("@/lib/prisma");

      const result = await updateDecisionRecommendationStatus(recommendationId, "RESOLVED", adminId, "Reconciled against the claim.");
      expect(result.ok).toBe(true);

      const row = await prisma.decisionRecommendation.findUnique({ where: { id: recommendationId } });
      expect(row!.status).toBe("RESOLVED");
      expect(row!.resolvedAt).not.toBeNull();
    });

    it("rejects an illegal direct transition (RESOLVED -> ACKNOWLEDGED)", async () => {
      if (skipAll || !recommendationId) return;
      const { updateDecisionRecommendationStatus } = await import("@/lib/reporting/decision-intelligence-queries");
      const result = await updateDecisionRecommendationStatus(recommendationId, "ACKNOWLEDGED", adminId, null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it("allows RESOLVED to be reopened (back to OPEN), clearing resolvedAt and preserving the full prior history", async () => {
      if (skipAll || !recommendationId) return;
      const { updateDecisionRecommendationStatus } = await import("@/lib/reporting/decision-intelligence-queries");
      const { prisma } = await import("@/lib/prisma");

      const result = await updateDecisionRecommendationStatus(recommendationId, "OPEN", adminId, "Issue recurred.");
      expect(result.ok).toBe(true);

      const row = await prisma.decisionRecommendation.findUnique({ where: { id: recommendationId } });
      expect(row!.status).toBe("OPEN");
      expect(row!.resolvedAt).toBeNull();

      const events = await prisma.decisionRecommendationEvent.findMany({ where: { decisionRecommendationId: recommendationId }, orderBy: { createdAt: "asc" } });
      // CREATED, ACKNOWLEDGED, RESOLVED, REOPENED -- all four preserved, never overwritten.
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.eventType)).toEqual(["CREATED", "ACKNOWLEDGED", "RESOLVED", "REOPENED"]);
    });

    it("regeneration after a status change never resets status or history", async () => {
      if (skipAll || !recommendationId) return;
      const { evaluateAndSyncDecisionRecommendations } = await import("@/lib/reporting/decision-intelligence-queries");
      const { prisma } = await import("@/lib/prisma");

      // Move it to ACKNOWLEDGED, then regenerate, and confirm the UPDATE
      // path left status (and the event count) untouched.
      const { updateDecisionRecommendationStatus } = await import("@/lib/reporting/decision-intelligence-queries");
      await updateDecisionRecommendationStatus(recommendationId, "ACKNOWLEDGED", adminId, "re-ack for regen check");

      await evaluateAndSyncDecisionRecommendations(emptyDecisionFilters({ currency: CURRENCY }), { id: adminId, role: "ADMINISTRATOR" });

      const row = await prisma.decisionRecommendation.findUnique({ where: { id: recommendationId } });
      expect(row!.status).toBe("ACKNOWLEDGED");

      const events = await prisma.decisionRecommendationEvent.findMany({ where: { decisionRecommendationId: recommendationId } });
      expect(events).toHaveLength(5); // the 4 above + the one ACKNOWLEDGED just made; regeneration itself adds none.
    });
  });

  describe("getDecisionRecommendationDetail / listDecisionRecommendations / getDecisionIntelligenceOverview", () => {
    it("getDecisionRecommendationDetail returns full evidence metrics and the complete ordered history", async () => {
      if (skipAll || !recommendationId) return;
      const { getDecisionRecommendationDetail } = await import("@/lib/reporting/decision-intelligence-queries");
      const detail = await getDecisionRecommendationDetail(recommendationId);
      expect(detail).not.toBeNull();
      expect(detail!.decisionCategory).toBe("COMMERCIAL_EXPOSURE");
      expect((detail!.evidence as { metrics: Record<string, unknown> }).metrics.unmatchedCount).toBe(2);
      expect(detail!.history.length).toBeGreaterThanOrEqual(5);
    });

    it("returns null for a nonexistent recommendation id -- never throws", async () => {
      if (skipAll) return;
      const { getDecisionRecommendationDetail } = await import("@/lib/reporting/decision-intelligence-queries");
      expect(await getDecisionRecommendationDetail("nonexistent-cuid-value")).toBeNull();
    });

    it("listDecisionRecommendations surfaces the created recommendation under a matching decisionCategory/currency filter", async () => {
      if (skipAll || !recommendationId) return;
      const { listDecisionRecommendations } = await import("@/lib/reporting/decision-intelligence-queries");
      const result = await listDecisionRecommendations(
        emptyDecisionFilters({ currency: CURRENCY, decisionCategory: "COMMERCIAL_EXPOSURE" }),
        { page: 1, pageSize: 50 },
        { id: adminId, role: "ADMINISTRATOR" }
      );
      expect(result.rows.some((r) => r.id === recommendationId)).toBe(true);
    });

    it("getDecisionIntelligenceOverview's summary tallies the created recommendation under COMMERCIAL_EXPOSURE", async () => {
      if (skipAll || !recommendationId) return;
      const { getDecisionIntelligenceOverview } = await import("@/lib/reporting/decision-intelligence-queries");
      const overview = await getDecisionIntelligenceOverview(emptyDecisionFilters({ currency: CURRENCY }), { id: adminId, role: "ADMINISTRATOR" });
      expect(overview.summary.byCategory.COMMERCIAL_EXPOSURE).toBeGreaterThanOrEqual(1);
      expect(overview.summary.totalRecommendations).toBeGreaterThanOrEqual(1);
    });
  });

  describe("demo-data exclusion at generation time (spec section 5 persisted-row rule)", () => {
    it("never creates a DecisionRecommendation from an isDemo:true source row, even when includeDemo:true is explicitly requested", async () => {
      if (skipAll) return;
      const { evaluateAndSyncDecisionRecommendations } = await import("@/lib/reporting/decision-intelligence-queries");
      const { prisma } = await import("@/lib/prisma");

      const { candidates } = await evaluateAndSyncDecisionRecommendations(emptyDecisionFilters({ currency: DEMO_CURRENCY, includeDemo: true }), { id: adminId, role: "ADMINISTRATOR" });
      expect(candidates.find((c) => c.dedupeKey === DEMO_DEDUPE_KEY)).toBeUndefined();

      const row = await prisma.decisionRecommendation.findUnique({ where: { dedupeKey: DEMO_DEDUPE_KEY } });
      expect(row).toBeNull();
    });
  });
});
