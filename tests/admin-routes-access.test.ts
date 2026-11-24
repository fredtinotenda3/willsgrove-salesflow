import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every /api/admin endpoint must refuse unauthenticated users, SALESPERSON and
 * SALES_MANAGER on the server, and reject a foreign Origin, before any service
 * runs. Session resolution is mocked (no database).
 */
let mockUser: { id: string; role: string } | null = null;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (mockUser ? { value: "fake" } : undefined) }) }));
vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE_NAME: "sf_session", resolveSession: async (v: string | undefined) => (!v || !mockUser ? null : { user: mockUser }), revokeAllSessionsForUser: vi.fn() }));

const svc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => svc.fn }) }));
vi.mock("@/lib/admin/user-admin", () => ({ updateUserProfile: svc.fn, setUserStatus: svc.fn, adminPasswordAction: svc.fn }));
vi.mock("@/lib/admin/assignment-admin", () => ({ executeReassignment: svc.fn, planReassignment: svc.fn, collectUserOwnedIds: svc.fn }));
vi.mock("@/lib/admin/catalogue-admin", () => ({ createProduct: svc.fn, updateProduct: svc.fn, setProductStatus: svc.fn, updatePriceList: svc.fn, setPriceListStatus: svc.fn }));
vi.mock("@/lib/admin/settings-store", () => ({ changeSetting: svc.fn }));
vi.mock("@/lib/admin/audit-queries", () => ({ listAuditEvents: svc.fn, auditRowsToCsv: svc.fn }));

const ORIGIN = "https://app.willsgrove.test";
const ctx = { params: Promise.resolve({ id: "abc123" }) };
const reason = "needed for testing";

type Case = { name: string; load: () => Promise<Record<string, (...a: never[]) => Promise<Response>>>; method: string; body?: unknown; withCtx: boolean };
const cases: Case[] = [
  { name: "users/[id] PATCH", load: () => import("@/app/api/admin/users/[id]/route") as never, method: "PATCH", body: { role: "SALES_MANAGER", reason }, withCtx: true },
  { name: "users/[id]/status POST", load: () => import("@/app/api/admin/users/[id]/status/route") as never, method: "POST", body: { status: "INACTIVE", reason }, withCtx: true },
  { name: "users/[id]/password POST", load: () => import("@/app/api/admin/users/[id]/password/route") as never, method: "POST", body: { action: "reset", reason }, withCtx: true },
  { name: "assignments/reassign POST", load: () => import("@/app/api/admin/assignments/reassign/route") as never, method: "POST", body: { entityType: "ORDER", ids: ["o1"], toUserId: "u2", reason }, withCtx: false },
  { name: "assignments/reassign-user POST", load: () => import("@/app/api/admin/assignments/reassign-user/route") as never, method: "POST", body: { fromUserId: "u1", toUserId: "u2", entityTypes: ["ORDER"], reason }, withCtx: false },
  { name: "products POST", load: () => import("@/app/api/admin/products/route") as never, method: "POST", body: { sapItemCode: "FV-1", itemName: "Tomatoes" }, withCtx: false },
  { name: "products/[id] PATCH", load: () => import("@/app/api/admin/products/[id]/route") as never, method: "PATCH", body: { itemName: "Tomato", reason }, withCtx: true },
  { name: "products/[id]/status POST", load: () => import("@/app/api/admin/products/[id]/status/route") as never, method: "POST", body: { status: "INACTIVE", reason }, withCtx: true },
  { name: "price-lists/[id] PATCH", load: () => import("@/app/api/admin/price-lists/[id]/route") as never, method: "PATCH", body: { name: "Retail", reason }, withCtx: true },
  { name: "price-lists/[id]/status POST", load: () => import("@/app/api/admin/price-lists/[id]/status/route") as never, method: "POST", body: { status: "INACTIVE", reason }, withCtx: true },
  { name: "settings POST", load: () => import("@/app/api/admin/settings/route") as never, method: "POST", body: { key: "admin.stuckOrderDays", value: 9, reason }, withCtx: false },
];

function req(c: Case, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request("https://app.willsgrove.test/api/admin/x", { method: c.method, headers, body: JSON.stringify(c.body) });
}
async function call(c: Case, origin?: string | null) {
  const mod = await c.load();
  const handler = mod[c.method] as (...a: unknown[]) => Promise<Response>;
  return c.withCtx ? handler(req(c, origin), ctx) : handler(req(c, origin));
}

beforeEach(() => { mockUser = null; process.env.APP_BASE_URL = ORIGIN; svc.fn.mockReset(); });

describe("/api/admin mutations are administrator-only on the server", () => {
  for (const c of cases) {
    it(`${c.name}: 401 anonymous, 403 salesperson and manager; no service runs`, async () => {
      expect((await call(c)).status).toBe(401);
      for (const role of ["SALESPERSON", "SALES_MANAGER"]) { mockUser = { id: "u9", role }; expect((await call(c)).status).toBe(403); }
      expect(svc.fn).not.toHaveBeenCalled();
    });
    it(`${c.name}: a foreign Origin is rejected even for an administrator`, async () => {
      mockUser = { id: "a1", role: "ADMINISTRATOR" };
      expect((await call(c, "https://evil.example")).status).toBe(403);
      expect(svc.fn).not.toHaveBeenCalled();
    });
  }

  it("an administrator with an invalid body gets 400 and nothing runs", async () => {
    mockUser = { id: "a1", role: "ADMINISTRATOR" };
    const { POST } = await import("@/app/api/admin/settings/route");
    const r = await POST(new Request("https://app.willsgrove.test/api/admin/settings", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ key: "x", value: 3 }) }) as never);
    expect(r.status).toBe(400);
    expect(svc.fn).not.toHaveBeenCalled();
  });

  it("audit export and the other exports refuse non-administrators", async () => {
    const { GET } = await import("@/app/api/admin/audit/export/route");
    const get = () => GET(new Request("https://app.willsgrove.test/api/admin/audit/export") as never);
    expect((await get()).status).toBe(401);
    mockUser = { id: "m1", role: "SALES_MANAGER" };
    expect((await get()).status).toBe(403);
    const customers = await import("@/app/api/admin/customers/export/route");
    const users = await import("@/app/api/admin/users/export/route");
    expect((await customers.GET()).status).toBe(403);
    expect((await users.GET()).status).toBe(403);
    expect(svc.fn).not.toHaveBeenCalled();
  });

  it("passes the acting administrator and validated input to the service", async () => {
    mockUser = { id: "a1", role: "ADMINISTRATOR" };
    svc.fn.mockResolvedValue({ ok: true, changed: true });
    const c = cases.find((x) => x.name === "users/[id]/status POST")!;
    const res = await call(c);
    expect(res.status).toBe(200);
    expect(svc.fn).toHaveBeenCalledWith("abc123", "INACTIVE", reason, "a1");
  });
});
