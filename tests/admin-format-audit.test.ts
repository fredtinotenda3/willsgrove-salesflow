import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { Prisma } from "@prisma/client";
import { buildAuditData } from "@/lib/admin/audit";
import { fmtDate, fmtDateTime, fmtInt, fmtMoney, humanize, pctChange } from "@/lib/admin/format";

describe("audit event shape", () => {
  it("records actor, action, entity, before/after, reason and outcome", () => {
    const d = buildAuditData({ actorId: "a1", action: "ORDER_ADMIN_DELETE", entityType: "CustomerOrder", entityId: "o1", before: { status: "DRAFT" }, after: { deleted: true }, reason: "duplicate draft" });
    expect(d).toMatchObject({ actorId: "a1", action: "ORDER_ADMIN_DELETE", entityType: "CustomerOrder", entityId: "o1", beforeData: { status: "DRAFT" }, afterData: { deleted: true, reason: "duplicate draft", outcome: "SUCCESS" } });
  });
  it("uses JsonNull (not undefined) when there is no previous state, and records refusals as REFUSED", () => {
    const d = buildAuditData({ actorId: "a1", action: "X", entityType: "T", entityId: "1", outcome: "REFUSED" });
    expect(d.beforeData).toBe(Prisma.JsonNull);
    expect(d.afterData).toEqual({ outcome: "REFUSED" });
  });
  it("does not let caller data override the stated reason or outcome", () => {
    const d = buildAuditData({ actorId: "a1", action: "X", entityType: "T", entityId: "1", after: { reason: "spoofed", outcome: "SUCCESS" }, reason: "real", outcome: "FAILED" });
    expect(d.afterData).toEqual({ reason: "real", outcome: "FAILED" });
  });
});

describe("display formatting", () => {
  it("formats money from the stored string without floating-point maths, and never mixes currencies", () => {
    expect(fmtMoney("USD", "1234567.5")).toBe("$1,234,567.50");
    expect(fmtMoney("ZWG", "0.1")).toBe("ZWG 0.10");
    expect(fmtMoney("USD", "-1200")).toBe("-$1,200.00");
    expect(fmtMoney("USD", "12abc")).toBe("—");
    expect(fmtMoney("USD", null)).toBe("—");
    expect(fmtMoney(null, "5")).toBe("$5.00");
    expect(fmtMoney("USD", { toString: () => "19.999" })).toBe("$19.99");
  });
  it("formats dates defensively", () => {
    expect(fmtDate(new Date("2026-03-04T23:59:00Z"))).toBe("2026-03-04");
    expect(fmtDateTime("2026-03-04T10:05:00Z")).toBe("2026-03-04 10:05");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
  });
  it("humanizes enum values and counts", () => { expect(humanize("PENDING_VERIFICATION")).toBe("Pending verification"); expect(humanize(null)).toBe("—"); expect(fmtInt(12345)).toBe("12,345"); });
  it("does not invent a percentage from a zero baseline", () => { expect(pctChange(5, 0)).toBeNull(); expect(pctChange(15, 10)).toBe(50); expect(pctChange(5, 10)).toBe(-50); expect(pctChange(0, 0)).toBeNull(); });
});
