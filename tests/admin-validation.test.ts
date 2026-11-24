import { describe, expect, it } from "vitest";
import { parseAuditFilters } from "@/lib/admin/audit-filters";
import { toCsv, csvCell } from "@/lib/admin/csv";
import { readPaging } from "@/lib/admin/paging";
import { passwordActionSchema, productCreateSchema, productUpdateSchema, reassignSchema, updateUserSchema, userStatusSchema } from "@/lib/admin/validation";

describe("admin validation", () => {
  it("requires a reason for sensitive changes", () => {
    expect(userStatusSchema.safeParse({ status: "INACTIVE" }).success).toBe(false);
    expect(userStatusSchema.safeParse({ status: "INACTIVE", reason: "ab" }).success).toBe(false);
    expect(userStatusSchema.safeParse({ status: "INACTIVE", reason: "left the company" }).success).toBe(true);
    expect(passwordActionSchema.safeParse({ action: "reset", reason: "forgot" }).success).toBe(true);
    expect(passwordActionSchema.safeParse({ action: "show-password", reason: "forgot" }).success).toBe(false);
  });
  it("rejects an empty or unknown-role user update", () => {
    expect(updateUserSchema.safeParse({ reason: "because" }).success).toBe(false);
    expect(updateUserSchema.safeParse({ role: "SUPERUSER", reason: "because" }).success).toBe(false);
    expect(updateUserSchema.safeParse({ role: "SALES_MANAGER", reason: "promotion" }).success).toBe(true);
  });
  it("never allows the SAP item code to be edited", () => {
    expect(productUpdateSchema.safeParse({ sapItemCode: "X1", reason: "typo fix" }).success).toBe(false);
    expect(productUpdateSchema.safeParse({ itemName: "Baby Marrow 500g", reason: "rename" }).success).toBe(true);
  });
  it("validates new product codes", () => {
    expect(productCreateSchema.safeParse({ sapItemCode: "FV 001", itemName: "Tomatoes" }).success).toBe(false);
    const ok = productCreateSchema.safeParse({ sapItemCode: "FV-001", itemName: "Tomatoes", barcode: "" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.barcode).toBeNull();
  });
  it("bounds bulk reassignment", () => {
    const base = { entityType: "ORDER", toUserId: "u1", reason: "cover leave" };
    expect(reassignSchema.safeParse({ ...base, ids: [] }).success).toBe(false);
    expect(reassignSchema.safeParse({ ...base, ids: Array.from({ length: 501 }, (_, i) => `id${i}`) }).success).toBe(false);
    expect(reassignSchema.safeParse({ ...base, ids: ["a"], entityType: "USER" }).success).toBe(false);
    const ok = reassignSchema.safeParse({ ...base, ids: ["a"] });
    expect(ok.success && ok.data.confirm).toBe(false); // previews by default
  });
});

describe("audit filters, paging and CSV", () => {
  it("drops malformed filter values", () => {
    const f = parseAuditFilters({ from: "yesterday", to: "2026-11-30", entity: "  ", q: "x".repeat(300) });
    expect(f.from).toBeUndefined();
    expect(f.to?.toISOString()).toBe("2026-11-30T23:59:59.999Z");
    expect(f.entityType).toBeUndefined();
    expect(f.q?.length).toBe(100);
  });
  it("clamps paging", () => {
    expect(readPaging({ page: "-3", pageSize: "100000" })).toEqual({ page: 1, pageSize: 100 });
    expect(readPaging({ page: "4", pageSize: "10" })).toEqual({ page: 4, pageSize: 10 });
    expect(readPaging({})).toEqual({ page: 1, pageSize: 25 });
  });
  it("neutralises spreadsheet formulas and escapes quotes", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell(null)).toBe('""');
    expect(toCsv(["a", "b"], [["x", 1]])).toBe('"a","b"\r\n"x","1"');
  });
});
