import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Milestone 15 (Decision Intelligence). Access-control tests for the
 * M15 API surface, run UNCONDITIONALLY (no database needed) by mocking
 * session resolution only -- same approach as
 * tests/product-intelligence-access.test.ts and
 * tests/customer-intelligence-access.test.ts, not the role-gating logic
 * itself.
 *
 * Every M15 route (app/api/reports/decision-intelligence/route.ts,
 * its recommendations/[list,detail,history,export] siblings) calls
 * requireManagementReportAccess() -- SALES_MANAGER/ADMINISTRATOR only,
 * confirmed by direct source inspection, so testing the shared function
 * once here covers all of them, same "don't re-derive a separate
 * assertion per route" principle M14's own access test states.
 *
 * The one mutation
 * (app/api/reports/decision-intelligence/recommendations/[id]/status/
 * route.ts) instead calls requireUserOrResponse(["SALES_MANAGER",
 * "ADMINISTRATOR"]) directly (same role list, different helper, because
 * it is a mutation rather than a report read) -- tested separately
 * below. Its CSRF origin check is already covered generically by
 * tests/csrf.test.ts and is not re-derived here.
 */

let mockUser: { id: string; role: string } | null = null;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mockUser ? { value: "fake-session-cookie" } : undefined),
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE_NAME: "sf_session",
  resolveSession: async (cookieValue: string | undefined) => {
    if (!cookieValue || !mockUser) return null;
    return { user: mockUser };
  },
}));

describe("Milestone 15: management-only report routes (requireManagementReportAccess)", () => {
  beforeEach(() => {
    mockUser = null;
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");
    const auth = await requireManagementReportAccess();
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("rejects SALESPERSON with 403 -- decision intelligence is management-only, unlike Product 360/Customer 360 which are open to all roles", async () => {
    mockUser = { id: "user-sales-1", role: "SALESPERSON" };
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");
    const auth = await requireManagementReportAccess();
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
  });

  it("allows SALES_MANAGER", async () => {
    mockUser = { id: "user-mgr-1", role: "SALES_MANAGER" };
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");
    expect((await requireManagementReportAccess()).ok).toBe(true);
  });

  it("allows ADMINISTRATOR", async () => {
    mockUser = { id: "user-admin-1", role: "ADMINISTRATOR" };
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");
    expect((await requireManagementReportAccess()).ok).toBe(true);
  });
});

describe("Milestone 15: status mutation route (requireUserOrResponse([\"SALES_MANAGER\", \"ADMINISTRATOR\"]))", () => {
  beforeEach(() => {
    mockUser = null;
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { requireUserOrResponse } = await import("@/lib/auth/current-user");
    const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("rejects SALESPERSON with 403 -- there is no SALESPERSON-level mutation on this surface", async () => {
    mockUser = { id: "user-sales-1", role: "SALESPERSON" };
    const { requireUserOrResponse } = await import("@/lib/auth/current-user");
    const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
  });

  it("allows SALES_MANAGER and ADMINISTRATOR", async () => {
    const { requireUserOrResponse } = await import("@/lib/auth/current-user");
    mockUser = { id: "user-mgr-1", role: "SALES_MANAGER" };
    expect((await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"])).ok).toBe(true);
    mockUser = { id: "user-admin-1", role: "ADMINISTRATOR" };
    expect((await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"])).ok).toBe(true);
  });
});

describe("Milestone 15: invalid recommendation id handling (shared guard on every [id] route)", () => {
  it("isValidId rejects malformed ids -- the exact guard every [id] route under app/api/reports/decision-intelligence/recommendations/[id]/ calls before doing anything else", async () => {
    const { isValidId } = await import("@/lib/http");
    expect(isValidId("")).toBe(false);
    expect(isValidId("not a valid id!")).toBe(false);
    expect(isValidId("' OR 1=1")).toBe(false);
  });
});

describe("Milestone 15: status update validation schema", () => {
  it("accepts every valid DecisionRecommendationStatus value with an optional note", async () => {
    const { updateDecisionRecommendationStatusSchema } = await import("@/lib/reporting/decision-intelligence-validation");
    for (const status of ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"]) {
      expect(updateDecisionRecommendationStatusSchema.safeParse({ status }).success).toBe(true);
      expect(updateDecisionRecommendationStatusSchema.safeParse({ status, note: "reviewed" }).success).toBe(true);
    }
  });

  it("rejects an invalid status value", async () => {
    const { updateDecisionRecommendationStatusSchema } = await import("@/lib/reporting/decision-intelligence-validation");
    expect(updateDecisionRecommendationStatusSchema.safeParse({ status: "DELETED" }).success).toBe(false);
    expect(updateDecisionRecommendationStatusSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a note longer than 2000 characters", async () => {
    const { updateDecisionRecommendationStatusSchema } = await import("@/lib/reporting/decision-intelligence-validation");
    expect(updateDecisionRecommendationStatusSchema.safeParse({ status: "OPEN", note: "x".repeat(2001) }).success).toBe(false);
  });
});
