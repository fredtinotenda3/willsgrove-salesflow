import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Administration services against a mocked Prisma client (no database):
 * the rules that must hold inside the transaction -- last-administrator
 * protection, assignee eligibility, protected records skipped, duplicate
 * detection, price-list dependencies, setting validation -- and that every
 * successful change writes an audit event with before/after and the reason.
 */
const { tx, prismaMock, revokeAll } = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() });
  const tx = { user: model(), customerOrder: model(), quotation: model(), customer: model(), invoiceClaim: model(), managementAction: model(), product: model(), priceList: model(), systemSetting: model(), auditEvent: model() };
  const prismaMock = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { tx, prismaMock, revokeAll: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({ revokeAllSessionsForUser: revokeAll }));
vi.mock("@/lib/auth/password", () => ({ generateTemporaryPassword: () => "Temp-Pass-123!", hashPassword: async () => "HASH" }));

import { adminPasswordAction, setUserStatus, updateUserProfile } from "@/lib/admin/user-admin";
import { executeReassignment, planReassignment } from "@/lib/admin/assignment-admin";
import { createProduct, setPriceListStatus, setProductStatus, updateProduct } from "@/lib/admin/catalogue-admin";
import { changeSetting } from "@/lib/admin/settings-store";

beforeEach(() => {
  for (const m of Object.values(tx)) for (const f of Object.values(m)) (f as ReturnType<typeof vi.fn>).mockReset();
  revokeAll.mockReset();
  tx.auditEvent.create.mockResolvedValue({});
  tx.auditEvent.createMany.mockResolvedValue({});
});

const audit = () => tx.auditEvent.create.mock.calls.map((c) => c[0].data);

describe("user administration", () => {
  it("refuses to deactivate the last active administrator and writes nothing", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "a2", role: "ADMINISTRATOR", status: "ACTIVE" });
    tx.user.count.mockResolvedValue(0);
    const r = await setUserStatus("a2", "INACTIVE", "cleanup", "a1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(0);
    expect(revokeAll).not.toHaveBeenCalled();
  });
  it("deactivates a user, audits the reason and ends their sessions", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u2", role: "SALESPERSON", status: "ACTIVE" });
    tx.user.count.mockResolvedValue(1);
    const r = await setUserStatus("u2", "INACTIVE", "left the company", "a1");
    expect(r).toEqual({ ok: true, changed: true });
    expect(audit()[0]).toMatchObject({ actorId: "a1", action: "USER_DEACTIVATE", entityId: "u2", afterData: { status: "INACTIVE", reason: "left the company" } });
    expect(revokeAll).toHaveBeenCalledWith("u2");
  });
  it("an administrator cannot demote or deactivate themselves", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "a1", name: "A", role: "ADMINISTRATOR", status: "ACTIVE", department: null });
    tx.user.count.mockResolvedValue(3);
    expect(await updateUserProfile("a1", { role: "SALES_MANAGER", reason: "test" }, "a1")).toMatchObject({ ok: false, status: 409 });
    expect(await setUserStatus("a1", "INACTIVE", "test", "a1")).toMatchObject({ ok: false, status: 409 });
  });
  it("a role change is audited with before/after and signs the user out", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u2", name: "U", role: "SALESPERSON", status: "ACTIVE", department: null });
    const r = await updateUserProfile("u2", { role: "SALES_MANAGER", reason: "promoted" }, "a1");
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(audit()[0]).toMatchObject({ action: "USER_UPDATE_ROLE", beforeData: { role: "SALESPERSON" }, afterData: { role: "SALES_MANAGER", reason: "promoted" } });
    expect(revokeAll).toHaveBeenCalledWith("u2");
  });
  it("a no-op update writes no audit event", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u2", name: "U", role: "SALESPERSON", status: "ACTIVE", department: null });
    expect(await updateUserProfile("u2", { name: "U", reason: "same" }, "a1")).toMatchObject({ ok: true, changed: false });
    expect(audit()).toHaveLength(0);
  });
  it("password reset returns the temporary password once and never audits it", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u2", status: "ACTIVE" });
    const r = await adminPasswordAction("u2", "reset", "forgot", "a1");
    expect(r).toEqual({ ok: true, temporaryPassword: "Temp-Pass-123!" });
    expect(tx.user.update.mock.calls[0][0].data).toMatchObject({ mustChangePassword: true, passwordHash: "HASH" });
    expect(JSON.stringify(audit())).not.toContain("Temp-Pass-123!");
    expect(JSON.stringify(audit())).not.toContain("HASH");
    expect(revokeAll).toHaveBeenCalledWith("u2");
  });
  it("won't reset the password of an inactive user", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u2", status: "INACTIVE" });
    expect(await adminPasswordAction("u2", "reset", "forgot", "a1")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("assignment management", () => {
  it("never assigns to an inactive user", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u3", name: "Gone", status: "INACTIVE", role: "SALESPERSON" });
    expect(await executeReassignment("ORDER", ["o1"], "u3", "cover", "a1")).toMatchObject({ ok: false, status: 409 });
    expect(tx.customerOrder.updateMany).not.toHaveBeenCalled();
  });
  it("skips invoiced/cancelled orders and ones already with the target, moves the rest, audits each", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u2", name: "New", status: "ACTIVE", role: "SALESPERSON" });
    tx.customerOrder.findMany.mockResolvedValue([
      { id: "o1", reference: "ORD-1", status: "APPROVED", salesperson: { id: "u1", name: "Old" } },
      { id: "o2", reference: "ORD-2", status: "READY_TO_INVOICE", salesperson: { id: "u1", name: "Old" } },
      { id: "o3", reference: "ORD-3", status: "CANCELLED", salesperson: null },
      { id: "o4", reference: "ORD-4", status: "RECEIVED", salesperson: { id: "u2", name: "New" } },
    ]);
    const r = await executeReassignment("ORDER", ["o1", "o2", "o3", "o4", "ghost"], "u2", "covering leave", "a1");
    expect(r.ok).toBe(true);
    expect(tx.customerOrder.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["o1"] } }, data: { salespersonId: "u2" } });
    const rows = tx.auditEvent.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([expect.objectContaining({ actorId: "a1", action: "ORDER_REASSIGN", entityId: "o1", beforeData: { assigneeId: "u1" }, afterData: { assigneeId: "u2", reason: "covering leave", bulkSize: 1 } })]);
    if (r.ok) expect(r.plan.skipped.map((s) => s.id).sort()).toEqual(["ghost", "o2", "o3", "o4"]);
  });
  it("a preview writes nothing", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u2", name: "New", status: "ACTIVE", role: "SALESPERSON" });
    tx.quotation.findMany.mockResolvedValue([{ id: "q1", quotationNumber: "Q-1", revisionNumber: 1, status: "ISSUED", convertedOrderId: null, supersededAt: null, salesperson: { id: "u1", name: "Old" } }]);
    const plan = await planReassignment(prismaMock as never, "QUOTATION", ["q1"], "u2");
    expect("eligible" in plan && plan.eligible).toHaveLength(1);
    expect(tx.quotation.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.createMany).not.toHaveBeenCalled();
  });
  it("converted and accepted quotations keep their owner", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u2", name: "New", status: "ACTIVE", role: "SALESPERSON" });
    tx.quotation.findMany.mockResolvedValue([
      { id: "q1", quotationNumber: "Q-1", revisionNumber: 1, status: "ACCEPTED", convertedOrderId: null, supersededAt: null, salesperson: { id: "u1", name: "Old" } },
      { id: "q2", quotationNumber: "Q-2", revisionNumber: 1, status: "DRAFT", convertedOrderId: "o9", supersededAt: null, salesperson: { id: "u1", name: "Old" } },
    ]);
    expect(await executeReassignment("QUOTATION", ["q1", "q2"], "u2", "cover", "a1")).toMatchObject({ ok: false, status: 409 });
    expect(tx.quotation.updateMany).not.toHaveBeenCalled();
  });
  it("refuses more than 500 records at once", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u2", name: "New", status: "ACTIVE", role: "SALESPERSON" });
    const ids = Array.from({ length: 501 }, (_, i) => `o${i}`);
    expect(await planReassignment(prismaMock as never, "ORDER", ids, "u2")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("catalogue administration", () => {
  it("rejects a duplicate SAP item code case-insensitively", async () => {
    tx.product.findFirst.mockResolvedValue({ sapItemCode: "FV-001" });
    const r = await createProduct({ sapItemCode: "fv-001", itemName: "X", barcode: null, category: null, unitOfMeasure: null, packSize: null, isVariableWeight: false, vatCode: null }, "a1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(tx.product.create).not.toHaveBeenCalled();
  });
  it("rejects a barcode already used by another product", async () => {
    tx.product.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ sapItemCode: "FV-002", itemName: "Other" });
    const r = await createProduct({ sapItemCode: "FV-009", itemName: "X", barcode: "6001", category: null, unitOfMeasure: null, packSize: null, isVariableWeight: false, vatCode: null }, "a1");
    expect(r).toMatchObject({ ok: false, status: 409, fieldErrors: { barcode: expect.any(String) } });
  });
  it("creates a product and audits it", async () => {
    tx.product.findFirst.mockResolvedValue(null);
    tx.product.create.mockResolvedValue({ id: "p1" });
    expect(await createProduct({ sapItemCode: "FV-010", itemName: "Spinach", barcode: null, category: null, unitOfMeasure: "KG", packSize: null, isVariableWeight: false, vatCode: null }, "a1")).toEqual({ ok: true, id: "p1" });
    expect(audit()[0]).toMatchObject({ action: "PRODUCT_CREATE", entityId: "p1", actorId: "a1" });
  });
  it("only writes and audits fields that actually changed, never the item code", async () => {
    tx.product.findUnique.mockResolvedValue({ id: "p1", sapItemCode: "FV-1", itemName: "Old", barcode: null, category: "Veg", unitOfMeasure: "KG", packSize: null, isVariableWeight: false, vatCode: null });
    const r = await updateProduct("p1", { itemName: "New", category: "Veg", reason: "rename" }, "a1");
    expect(r).toEqual({ ok: true, changed: true });
    expect(tx.product.update.mock.calls[0][0].data).toEqual({ itemName: "New" });
    expect(audit()[0]).toMatchObject({ beforeData: { itemName: "Old" }, afterData: { itemName: "New", reason: "rename" } });
  });
  it("archives rather than deletes", async () => {
    tx.product.findUnique.mockResolvedValue({ status: "ACTIVE" });
    expect(await setProductStatus("p1", "INACTIVE", "discontinued", "a1")).toEqual({ ok: true, changed: true });
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { status: "INACTIVE" } });
    expect((tx.product as Record<string, unknown>).delete).toBeUndefined();
  });
  it("won't deactivate a price list that customers still use", async () => {
    tx.priceList.findUnique.mockResolvedValue({ status: "ACTIVE", code: "RETAIL", _count: { customers: 4 } });
    expect(await setPriceListStatus("pl1", "INACTIVE", "retire", "a1")).toMatchObject({ ok: false, status: 409 });
    expect(tx.priceList.update).not.toHaveBeenCalled();
  });
  it("deactivates an unused price list with an audit event", async () => {
    tx.priceList.findUnique.mockResolvedValue({ status: "ACTIVE", code: "OLD", _count: { customers: 0 } });
    expect(await setPriceListStatus("pl1", "INACTIVE", "retire", "a1")).toEqual({ ok: true, changed: true });
    expect(audit()[0]).toMatchObject({ action: "PRICE_LIST_DEACTIVATE", afterData: { status: "INACTIVE", reason: "retire" } });
  });
});

describe("configuration changes", () => {
  it("validates, stores and audits before/after with the reason", async () => {
    tx.systemSetting.findMany.mockResolvedValue([]);
    expect(await changeSetting({ key: "quotation.defaultValidityDays", value: 14, reason: "policy change", actorId: "a1" })).toEqual({ ok: true });
    expect(tx.systemSetting.upsert).toHaveBeenCalled();
    expect(audit()[0]).toMatchObject({ action: "SYSTEM_SETTING_UPDATE", entityId: "quotation.defaultValidityDays", beforeData: { value: 30 }, afterData: { value: 14, reason: "policy change" } });
  });
  it("rejects unknown keys, out-of-range values and a missing reason without writing", async () => {
    tx.systemSetting.findMany.mockResolvedValue([]);
    expect(await changeSetting({ key: "auth.sessionHours", value: 1, reason: "x-ray", actorId: "a1" })).toMatchObject({ ok: false });
    expect(await changeSetting({ key: "quotation.defaultValidityDays", value: 9999, reason: "too long", actorId: "a1" })).toMatchObject({ ok: false });
    expect(await changeSetting({ key: "quotation.defaultValidityDays", value: 14, reason: " ", actorId: "a1" })).toMatchObject({ ok: false });
    expect(tx.systemSetting.upsert).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(0);
  });
  it("reset removes the override and audits it", async () => {
    tx.systemSetting.findMany.mockResolvedValue([{ key: "admin.stuckOrderDays", value: 14 }]);
    expect(await changeSetting({ key: "admin.stuckOrderDays", value: null, reason: "back to default", actorId: "a1" })).toEqual({ ok: true });
    expect(tx.systemSetting.deleteMany).toHaveBeenCalledWith({ where: { key: "admin.stuckOrderDays" } });
    expect(audit()[0]).toMatchObject({ action: "SYSTEM_SETTING_RESET", beforeData: { value: 14 }, afterData: { value: 7 } });
  });
});
