import { describe, expect, it } from "vitest";
import { actionKey, applyOperation, managementActionRequestSchema, type ActionOperation, type ActionStatus } from "@/lib/management-intelligence/action-state";

const ctx = (over: Partial<{ hasAssignee: boolean; assigneeId: string | null; note: string | null }> = {}) => ({ hasAssignee: false, assigneeId: null, note: null, ...over });
const to = (from: ActionStatus, op: ActionOperation, c = ctx()) => {
  const r = applyOperation(from, op, c);
  return r.ok ? r.to : `ERR:${r.message}`;
};

describe("management action lifecycle", () => {
  it("acknowledges only an unacknowledged action", () => {
    expect(to("OPEN", "ACKNOWLEDGE")).toBe("ACKNOWLEDGED");
    for (const s of ["ACKNOWLEDGED", "IN_PROGRESS", "COMPLETED", "DISMISSED"] as const) expect(to(s, "ACKNOWLEDGE")).toMatch(/^ERR/);
  });

  it("assigning an unacknowledged action acknowledges it, and keeps in-progress in progress", () => {
    expect(to("OPEN", "ASSIGN", ctx({ assigneeId: "u1" }))).toBe("ACKNOWLEDGED");
    expect(to("IN_PROGRESS", "ASSIGN", ctx({ assigneeId: "u1" }))).toBe("IN_PROGRESS");
    expect(to("ACKNOWLEDGED", "ASSIGN", ctx())).toMatch(/^ERR/);
    expect(to("COMPLETED", "ASSIGN", ctx({ assigneeId: "u1" }))).toMatch(/^ERR/);
  });

  it("starting needs an acknowledged action and an owner", () => {
    expect(to("ACKNOWLEDGED", "START", ctx({ hasAssignee: true }))).toBe("IN_PROGRESS");
    expect(to("ACKNOWLEDGED", "START", ctx({ hasAssignee: false }))).toMatch(/^ERR.*owner/);
    expect(to("OPEN", "START", ctx({ hasAssignee: true }))).toMatch(/^ERR/);
  });

  it("completing needs a recorded outcome: there is no automatic or empty completion", () => {
    expect(to("IN_PROGRESS", "COMPLETE", ctx({ note: "Supplier raised weekly quantity" }))).toBe("COMPLETED");
    expect(to("IN_PROGRESS", "COMPLETE", ctx())).toMatch(/^ERR.*outcome/);
    expect(to("ACKNOWLEDGED", "COMPLETE", ctx({ note: "  " }))).toMatch(/^ERR/);
    expect(to("OPEN", "COMPLETE", ctx({ note: "done" }))).toMatch(/^ERR/);
  });

  it("dismissing needs a reason and is not possible once closed", () => {
    expect(to("OPEN", "DISMISS", ctx({ note: "Known and accepted" }))).toBe("DISMISSED");
    expect(to("OPEN", "DISMISS", ctx())).toMatch(/^ERR.*reason/);
    expect(to("COMPLETED", "DISMISS", ctx({ note: "x".repeat(5) }))).toMatch(/^ERR/);
  });

  it("reopens only closed actions, back to open", () => {
    expect(to("COMPLETED", "REOPEN")).toBe("OPEN");
    expect(to("DISMISSED", "REOPEN")).toBe("OPEN");
    expect(to("IN_PROGRESS", "REOPEN")).toMatch(/^ERR/);
  });
});

describe("management action request validation", () => {
  const valid = { reportId: "picking-shortages", findingKey: "product-shortage:Baby Marrow", operation: "ACKNOWLEDGE" };
  it("accepts a well-formed request and trims the note", () => {
    const parsed = managementActionRequestSchema.safeParse({ ...valid, operation: "COMPLETE", note: "  Fixed  " });
    expect(parsed.success && parsed.data.note).toBe("Fixed");
  });
  it("rejects an unknown operation, missing keys and oversized notes", () => {
    expect(managementActionRequestSchema.safeParse({ ...valid, operation: "DELETE" }).success).toBe(false);
    expect(managementActionRequestSchema.safeParse({ reportId: "x" }).success).toBe(false);
    expect(managementActionRequestSchema.safeParse({ ...valid, note: "x".repeat(1001) }).success).toBe(false);
    expect(managementActionRequestSchema.safeParse({ ...valid, findingKey: "k".repeat(201) }).success).toBe(false);
  });
  it("builds a stable key", () => {
    expect(actionKey("lost-sales", "under-dispute")).toBe("lost-sales:under-dispute");
  });
});
