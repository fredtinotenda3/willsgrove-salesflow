import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression for the real items-import.csv (7,540 rows) never completing:
 * the import must never hold one database transaction across the file.
 * Mocked Prisma (no database).
 */
const { db } = vi.hoisted(() => {
  const tx = { product: { update: vi.fn() } };
  const db = {
    product: { createMany: vi.fn(), update: tx.product.update },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg !== "function") throw new Error("array-form $transaction must not be used");
      return (arg as (t: typeof tx) => unknown)(tx);
    }),
  };
  return { db };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { executeProductImport, type ProductImportPlan } from "@/lib/product-import";
import type { SapProductRow } from "@/lib/sap-product-csv";

const row = (n: number, name = `Item ${n}`): SapProductRow => ({ sapItemCode: String(n), itemName: name, barcode: null, category: "Veg", sourceData: { CODE: String(n) } } as SapProductRow);
const plan = (nNew: number, nChanged = 0): ProductImportPlan => ({
  newProducts: Array.from({ length: nNew }, (_, i) => row(i + 1)),
  changedProducts: Array.from({ length: nChanged }, (_, i) => ({ sapItemCode: `c${i}`, current: { sapItemCode: `c${i}`, itemName: "old", barcode: null, category: null }, incoming: row(100000 + i, "new name") })),
  unchangedProducts: [],
});

beforeEach(() => {
  db.product.createMany.mockReset().mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  db.product.update.mockReset().mockResolvedValue({});
  db.auditEvent.create.mockReset().mockResolvedValue({ id: "audit1" });
  db.$transaction.mockClear();
});

describe("executeProductImport", () => {
  it("imports 7,540 new products in bounded createMany chunks with no transaction", async () => {
    const r = await executeProductImport(plan(7540), "items-import.csv");
    expect(r).toMatchObject({ created: 7540, updated: 0, partial: false, auditEventId: "audit1" });
    expect(db.product.createMany).toHaveBeenCalledTimes(16);
    expect(Math.max(...db.product.createMany.mock.calls.map((c) => c[0].data.length))).toBeLessThanOrEqual(500);
    expect(db.product.createMany.mock.calls.every((c) => c[0].skipDuplicates === true)).toBe(true);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("updates changed products in small interactive transactions and never writes status", async () => {
    const r = await executeProductImport(plan(0, 120), "f.csv");
    expect(r.updated).toBe(120);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.product.update.mock.calls.every((c) => !("status" in c[0].data))).toBe(true);
  });

  it("reports a partial import honestly when a later chunk fails, counting only what committed", async () => {
    db.product.createMany.mockImplementationOnce(async ({ data }: { data: unknown[] }) => ({ count: data.length })).mockRejectedValueOnce(new Error("connection closed"));
    const r = await executeProductImport(plan(1200), "f.csv");
    expect(r).toMatchObject({ created: 500, partial: true, partialReason: "connection closed" });
    const audit = db.auditEvent.create.mock.calls[0][0].data;
    expect(audit.afterData).toMatchObject({ created: 500, plannedCreates: 1200, partial: true });
  });

  it("counts only rows actually inserted when skipDuplicates skips existing ones", async () => {
    db.product.createMany.mockResolvedValue({ count: 3 });
    expect((await executeProductImport(plan(10), "f.csv")).created).toBe(3);
  });
});
