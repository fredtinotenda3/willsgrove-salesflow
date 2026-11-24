import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Role and CSRF enforcement on the Action Centre API, with session
 * resolution mocked (no database). The routes call
 * requireManagementReportAccess(), so a salesperson is refused on the
 * server regardless of what the UI shows.
 */

let mockUser: { id: string; role: string } | null = null;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (mockUser ? { value: "fake-session-cookie" } : undefined) }) }));
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE_NAME: "sf_session",
  resolveSession: async (cookieValue: string | undefined) => (!cookieValue || !mockUser ? null : { user: mockUser }),
}));

const performManagementAction = vi.fn();
const listTrackedActions = vi.fn();
const listAssignableUsers = vi.fn();
vi.mock("@/lib/management-intelligence/actions", () => ({
  performManagementAction: (...args: unknown[]) => performManagementAction(...args),
  listTrackedActions: () => listTrackedActions(),
  listAssignableUsers: () => listAssignableUsers(),
}));

const ORIGIN = "https://app.willsgrove.test";
const body = { reportId: "lost-sales", findingKey: "under-dispute", operation: "ACKNOWLEDGE" };

function post(payload: unknown, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request("https://app.willsgrove.test/api/management-actions", { method: "POST", headers, body: JSON.stringify(payload) });
}

beforeEach(() => {
  mockUser = null;
  process.env.APP_BASE_URL = ORIGIN;
  performManagementAction.mockReset();
  listTrackedActions.mockReset().mockResolvedValue([]);
  listAssignableUsers.mockReset().mockResolvedValue([]);
});

describe("/api/management-actions access", () => {
  it("GET: 401 unauthenticated, 403 salesperson, 200 manager and administrator", async () => {
    const { GET } = await import("@/app/api/management-actions/route");
    expect((await GET()).status).toBe(401);
    mockUser = { id: "s1", role: "SALESPERSON" };
    expect((await GET()).status).toBe(403);
    expect(listTrackedActions).not.toHaveBeenCalled();
    mockUser = { id: "m1", role: "SALES_MANAGER" };
    expect((await GET()).status).toBe(200);
    mockUser = { id: "a1", role: "ADMINISTRATOR" };
    expect((await GET()).status).toBe(200);
  });

  it("POST: a salesperson cannot acknowledge or assign, even with a valid origin", async () => {
    const { POST } = await import("@/app/api/management-actions/route");
    mockUser = { id: "s1", role: "SALESPERSON" };
    expect((await POST(post(body) as never)).status).toBe(403);
    expect((await POST(post({ ...body, operation: "ASSIGN", assigneeId: "m1" }) as never)).status).toBe(403);
    expect(performManagementAction).not.toHaveBeenCalled();
  });

  it("POST: refuses a cross-origin request and a request with no origin", async () => {
    const { POST } = await import("@/app/api/management-actions/route");
    mockUser = { id: "m1", role: "SALES_MANAGER" };
    expect((await POST(post(body, "https://evil.example") as never)).status).toBe(403);
    expect((await POST(post(body, null) as never)).status).toBe(403);
    expect(performManagementAction).not.toHaveBeenCalled();
  });

  it("POST: validates the body server-side", async () => {
    const { POST } = await import("@/app/api/management-actions/route");
    mockUser = { id: "m1", role: "SALES_MANAGER" };
    expect((await POST(post({ ...body, operation: "DELETE" }) as never)).status).toBe(400);
    expect((await POST(post({ reportId: "lost-sales" }) as never)).status).toBe(400);
    expect((await POST(post({ ...body, operation: "ASSIGN", assigneeId: "../../etc" }) as never)).status).toBe(400);
    expect(performManagementAction).not.toHaveBeenCalled();
  });

  it("POST: a manager's valid request reaches the service with the session user as actor, and service errors keep their status", async () => {
    const { POST } = await import("@/app/api/management-actions/route");
    mockUser = { id: "m1", role: "SALES_MANAGER" };
    performManagementAction.mockResolvedValue({ ok: true, action: { id: "a1" } });
    const ok = await POST(post(body) as never);
    expect(ok.status).toBe(200);
    expect(performManagementAction).toHaveBeenCalledWith(expect.objectContaining({ reportId: "lost-sales", operation: "ACKNOWLEDGE" }), "m1");

    performManagementAction.mockResolvedValue({ ok: false, status: 409, message: "changed" });
    expect((await POST(post(body) as never)).status).toBe(409);
  });
});
