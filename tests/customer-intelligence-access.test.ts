import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Milestone 13 (Customer Intelligence). Access-control tests for the M13
 * API surface, run UNCONDITIONALLY (no database needed, unlike this
 * project's *-db.integration.test.ts files) by mocking the one external
 * boundary that would otherwise require a live database -- session
 * resolution (next/headers's cookies() and lib/auth/session.ts's
 * resolveSession) -- rather than the role-gating logic itself.
 *
 * This exercises the REAL requireUserOrResponse()/requireManagementReportAccess()
 * functions every M13 route calls; lib/auth/current-user.ts and
 * lib/reporting/access.ts are not reimplemented or stubbed here.
 *
 * Customer 360 (app/api/customers/[id]/profile/route.ts and its export
 * sibling) calls requireUserOrResponse() with NO role list -- open to
 * SALESPERSON, SALES_MANAGER and ADMINISTRATOR alike, per spec section
 * 10. The management overview (app/api/reports/customer-intelligence/
 * route.ts and its export sibling) calls requireManagementReportAccess(),
 * SALES_MANAGER/ADMINISTRATOR only. Within each surface, the view route
 * and its export route call the identical auth function with identical
 * arguments (confirmed by direct source inspection -- both routes of each
 * pair were written together in this milestone and share that one
 * line), so testing the shared function once here covers both; this file
 * does not re-derive a separate assertion per route.
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

describe("Milestone 13: access control", () => {
  beforeEach(() => {
    mockUser = null;
  });

  it("rejects an unauthenticated request with 401 on both the Customer 360 profile and the management overview", async () => {
    const { requireUserOrResponse } = await import("@/lib/auth/current-user");
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");

    const profileAuth = await requireUserOrResponse();
    expect(profileAuth.ok).toBe(false);
    if (!profileAuth.ok) expect(profileAuth.response.status).toBe(401);

    const overviewAuth = await requireManagementReportAccess();
    expect(overviewAuth.ok).toBe(false);
    if (!overviewAuth.ok) expect(overviewAuth.response.status).toBe(401);
  });

  it("SALESPERSON can access the Customer 360 profile, but gets 403 on the management overview", async () => {
    mockUser = { id: "user-sales-1", role: "SALESPERSON" };
    const { requireUserOrResponse } = await import("@/lib/auth/current-user");
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");

    const profileAuth = await requireUserOrResponse();
    expect(profileAuth.ok).toBe(true);

    const overviewAuth = await requireManagementReportAccess();
    expect(overviewAuth.ok).toBe(false);
    if (!overviewAuth.ok) expect(overviewAuth.response.status).toBe(403);
  });

  it("SALES_MANAGER can access both the Customer 360 profile and the management overview", async () => {
    mockUser = { id: "user-mgr-1", role: "SALES_MANAGER" };
    const { requireUserOrResponse } = await import("@/lib/auth/current-user");
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");

    expect((await requireUserOrResponse()).ok).toBe(true);
    expect((await requireManagementReportAccess()).ok).toBe(true);
  });

  it("ADMINISTRATOR can access both the Customer 360 profile and the management overview", async () => {
    mockUser = { id: "user-admin-1", role: "ADMINISTRATOR" };
    const { requireUserOrResponse } = await import("@/lib/auth/current-user");
    const { requireManagementReportAccess } = await import("@/lib/reporting/access");

    expect((await requireUserOrResponse()).ok).toBe(true);
    expect((await requireManagementReportAccess()).ok).toBe(true);
  });
});

describe("Milestone 13: invalid customer id handling (shared guard on the profile route and its export sibling)", () => {
  it("isValidId rejects malformed ids -- the exact guard both app/api/customers/[id]/profile/route.ts and its export sibling call before doing anything else", async () => {
    const { isValidId } = await import("@/lib/http");
    expect(isValidId("")).toBe(false);
    expect(isValidId("not a valid id!")).toBe(false);
    expect(isValidId("' OR 1=1")).toBe(false);
  });
});
