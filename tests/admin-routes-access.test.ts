import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Every /api/admin endpoint must refuse unauthenticated users, SALESPERSON and
 * SALES_MANAGER on the server, and reject a foreign Origin, before any service
 * runs. Session resolution is mocked (no database).
 */
let mockUser: { id: string; role: string } | null = null;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (mockUser ? { value: "fake" } : undefined) }) }));
vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE_NAME: "sf_session", resolveSession: async (v: string | undefined) => (!v || !mockUser ? null : { user: mockUser }), revokeAllSessionsForUser: vi.fn() }));

const svc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => Object.assign(svc.fn, { create: svc.fn }) }) }));
vi.mock("@/lib/admin/user-admin", () => ({ updateUserProfile: svc.fn, setUserStatus: svc.fn, adminPasswordAction: svc.fn }));
vi.mock("@/lib/admin/assignment-admin", () => ({ executeReassignment: svc.fn, planReassignment: svc.fn, collectUserOwnedIds: svc.fn }));
vi.mock("@/lib/admin/catalogue-admin", () => ({ createPriceList: svc.fn, createPriceEntry: svc.fn, deletePriceEntry: svc.fn, createProduct: svc.fn, updateProduct: svc.fn, setProductStatus: svc.fn, updatePriceList: svc.fn, setPriceListStatus: svc.fn }));
vi.mock("@/lib/admin/order-admin", () => ({ updateOrderDetails: svc.fn, cancelOrder: svc.fn, reopenOrder: svc.fn, listAdminOrders: svc.fn }));
vi.mock("@/lib/admin/record-deletion", () => ({ deleteDraftOrder: svc.fn, deleteCustomer: svc.fn, deleteProduct: svc.fn, deletePriceList: svc.fn, removeProductAlias: svc.fn }));
vi.mock("@/lib/admin/customer-admin", () => ({ createContact: svc.fn, updateContact: svc.fn, deleteContact: svc.fn, removeCustomerAlias: svc.fn }));
vi.mock("@/lib/admin/quotation-admin", () => ({ listAdminQuotations: svc.fn }));
vi.mock("@/lib/admin/finance-admin", () => ({ listAdminInvoices: svc.fn, listAdminClaims: svc.fn, listAdminCreditNotes: svc.fn, listAdminReturns: svc.fn }));
vi.mock("@/lib/admin/ops-admin", () => ({ listAdminApprovals: svc.fn, listAdminDispatches: svc.fn }));
vi.mock("@/lib/admin/settings-store", () => ({ changeSetting: svc.fn }));
vi.mock("@/lib/admin/audit-queries", () => ({ listAuditEvents: svc.fn, auditRowsToCsv: svc.fn }));

const ORIGIN = "https://app.willsgrove.test";
const ctx = { params: Promise.resolve({ id: "abc123", contactId: "abc123" }) };
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
  { name: "orders/[id] PATCH", load: () => import("@/app/api/admin/orders/[id]/route") as never, method: "PATCH", body: { internalNotes: "call before delivery", reason }, withCtx: true },
  { name: "orders/[id]/cancel POST", load: () => import("@/app/api/admin/orders/[id]/cancel/route") as never, method: "POST", body: { reason }, withCtx: true },
  { name: "orders/[id]/reopen POST", load: () => import("@/app/api/admin/orders/[id]/reopen/route") as never, method: "POST", body: { reason }, withCtx: true },
  { name: "price-lists POST", load: () => import("@/app/api/admin/price-lists/route") as never, method: "POST", body: { code: "RETAIL", name: "Retail", currencyCode: "USD" }, withCtx: false },
  { name: "price-lists/[id]/entries POST", load: () => import("@/app/api/admin/price-lists/[id]/entries/route") as never, method: "POST", body: { sapItemCode: "FV-1", unitPrice: "0.45", validFrom: "2026-01-01", reason }, withCtx: true },
  { name: "price-lists/entries/[id] DELETE", load: () => import("@/app/api/admin/price-lists/entries/[id]/route") as never, method: "DELETE", body: { reason }, withCtx: true },
  { name: "orders/[id] DELETE", load: () => import("@/app/api/admin/orders/[id]/route") as never, method: "DELETE", body: { reason }, withCtx: true },
  { name: "customers/[id] DELETE", load: () => import("@/app/api/admin/customers/[id]/route") as never, method: "DELETE", body: { reason }, withCtx: true },
  { name: "products/[id]/delete DELETE", load: () => import("@/app/api/admin/products/[id]/delete/route") as never, method: "DELETE", body: { reason }, withCtx: true },
  { name: "price-lists/[id]/delete DELETE", load: () => import("@/app/api/admin/price-lists/[id]/delete/route") as never, method: "DELETE", body: { reason }, withCtx: true },
  { name: "products/aliases/[id] DELETE", load: () => import("@/app/api/admin/products/aliases/[id]/route") as never, method: "DELETE", body: { reason }, withCtx: true },
  { name: "customers/aliases/[id] DELETE", load: () => import("@/app/api/admin/customers/aliases/[id]/route") as never, method: "DELETE", body: { reason }, withCtx: true },
  { name: "customers/[id]/contacts POST", load: () => import("@/app/api/admin/customers/[id]/contacts/route") as never, method: "POST", body: { name: "Jane Moyo", reason }, withCtx: true },
  { name: "customers/[id]/contacts/[contactId] PATCH", load: () => import("@/app/api/admin/customers/[id]/contacts/[contactId]/route") as never, method: "PATCH", body: { name: "Jane M", reason }, withCtx: true },
  { name: "customers/[id]/contacts/[contactId] DELETE", load: () => import("@/app/api/admin/customers/[id]/contacts/[contactId]/route") as never, method: "DELETE", body: { reason }, withCtx: true },
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

  it("the generic export refuses non-administrators, rejects unknown entities and audits an allowed export", async () => {
    const { GET } = await import("@/app/api/admin/export/[entity]/route");
    const get = (entity: string) => GET(new NextRequest(`https://app.willsgrove.test/api/admin/export/${encodeURIComponent(entity)}`), { params: Promise.resolve({ entity }) });
    expect((await get("orders")).status).toBe(401);
    mockUser = { id: "m1", role: "SALES_MANAGER" };
    expect((await get("orders")).status).toBe(403);
    expect(svc.fn).not.toHaveBeenCalled();
    mockUser = { id: "a1", role: "ADMINISTRATOR" };
    expect((await get("users; drop table")).status).toBe(404);
    expect((await get("__proto__")).status).toBe(404);
    expect((await get("constructor")).status).toBe(404);
    expect(svc.fn).not.toHaveBeenCalled();
    svc.fn.mockResolvedValue({ total: 1, rows: [{ reference: "ORD-1", customer: { name: "Acme" }, status: "DRAFT", source: "MANUAL", salesperson: null, currency: "USD", total: "10.00", lineCount: 1, createdAt: new Date("2026-01-01T00:00:00Z") }] });
    const ok = await get("orders");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
    expect(await ok.text()).toContain("ORD-1");
    // the export is itself audited
    expect(svc.fn).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "DATA_EXPORT", actorId: "a1", entityType: "orders" }) }));
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
