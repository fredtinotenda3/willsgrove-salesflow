import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Management action tracking against a mocked Prisma client (no database):
 * assignment, acknowledgement, audit trail, assignee rules and the guard
 * against two managers moving the same action. The finding itself is
 * recomputed on the server, so getReportIntelligence is mocked here.
 */

type Row = { id: string; status: string; assignedToId: string | null };

const state = { row: null as Row | null };
const { tx, prismaMock } = vi.hoisted(() => {
  const tx = {
    managementAction: { upsert: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    managementActionEvent: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  const prismaMock = {
    user: { findUnique: vi.fn() },
    managementAction: { findUnique: vi.fn() },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  return { tx, prismaMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/management-intelligence/queries", () => ({
  defaultManagementFilters: () => ({}),
  getReportIntelligence: vi.fn(),
}));

import { getReportIntelligence } from "@/lib/management-intelligence/queries";
import { performManagementAction } from "@/lib/management-intelligence/actions";

const finding = {
  key: "product-shortage:Baby Marrow",
  reportId: "picking-shortages",
  topic: "shortage-product:Baby Marrow",
  tag: "shortage",
  title: "Repeated shortage: Baby Marrow",
  finding: "Baby Marrow fell short on 5 order lines.",
  evidence: [{ label: "Short lines", value: "5" }],
  businessImpact: "impact",
  recommendedAction: "action",
  responsibleFunction: "PURCHASING",
  priority: "HIGH",
  timeframe: "Within 3 working days",
  expectedOutcome: "outcome",
  measurement: "measure",
  links: [],
};

function selected(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    findingKey: "picking-shortages:product-shortage:Baby Marrow",
    reportId: "picking-shortages",
    topic: finding.topic,
    title: finding.title,
    finding: finding.finding,
    recommendedAction: "action",
    priority: "HIGH",
    responsibleFunction: "PURCHASING",
    status: "ACKNOWLEDGED",
    assignedToId: null,
    assignedTo: null,
    assignedAt: null,
    statusNote: null,
    statusAt: new Date("2026-11-24T08:00:00Z"),
    completedAt: null,
    createdAt: new Date("2026-11-24T08:00:00Z"),
    evidence: [{ label: "Short lines", value: "5" }],
    ...over,
  };
}

const request = (over: Record<string, unknown> = {}) => ({ reportId: "picking-shortages", findingKey: finding.key, operation: "ACKNOWLEDGE" as const, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  state.row = { id: "a1", status: "OPEN", assignedToId: null };
  prismaMock.managementAction.findUnique.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ id: "m2", status: "ACTIVE", role: "SALES_MANAGER" });
  vi.mocked(getReportIntelligence).mockResolvedValue({ reportId: "picking-shortages", findings: [finding as never], insufficientEvidence: [], noActionIndicated: false });
  tx.managementAction.upsert.mockImplementation(async () => state.row);
  tx.managementAction.findUniqueOrThrow.mockImplementation(async (args: { select?: unknown }) => (args.select && "findingKey" in (args.select as object) ? selected() : state.row));
  tx.managementAction.updateMany.mockResolvedValue({ count: 1 });
  tx.managementActionEvent.create.mockResolvedValue({});
  tx.auditEvent.create.mockResolvedValue({});
});

describe("performManagementAction", () => {
  it("acknowledges a finding for the first time: stores the server-computed snapshot, an event and an audit row", async () => {
    const result = await performManagementAction(request(), "mgr1");
    expect(result.ok).toBe(true);
    const created = tx.managementAction.upsert.mock.calls[0][0].create;
    expect(created.findingKey).toBe("picking-shortages:product-shortage:Baby Marrow");
    expect(created.evidence).toEqual(finding.evidence);
    expect(created.responsibleFunction).toBe("PURCHASING");
    expect(tx.managementAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1", status: "OPEN" }, data: expect.objectContaining({ status: "ACKNOWLEDGED", statusById: "mgr1" }) }));
    expect(tx.managementActionEvent.create.mock.calls[0][0].data).toMatchObject({ eventType: "ACKNOWLEDGED", fromStatus: "OPEN", toStatus: "ACKNOWLEDGED", actorId: "mgr1" });
    expect(tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ actorId: "mgr1", action: "MANAGEMENT_ACTION_ACKNOWLEDGED", entityType: "ManagementAction", entityId: "a1" });
  });

  it("never takes finding text from the request", async () => {
    await performManagementAction({ ...request(), title: "Injected", finding: "Injected" } as never, "mgr1");
    expect(tx.managementAction.upsert.mock.calls[0][0].create.title).toBe(finding.title);
  });

  it("refuses to act on a finding that is not in the current data", async () => {
    vi.mocked(getReportIntelligence).mockResolvedValue({ reportId: "picking-shortages", findings: [], insufficientEvidence: [], noActionIndicated: true });
    const result = await performManagementAction(request(), "mgr1");
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(tx.managementAction.upsert).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown report id", async () => {
    expect(await performManagementAction(request({ reportId: "nope" }), "mgr1")).toMatchObject({ ok: false, status: 400 });
  });

  it("assigns to an active manager, recording who assigned and when", async () => {
    const result = await performManagementAction(request({ operation: "ASSIGN", assigneeId: "m2" }), "mgr1");
    expect(result.ok).toBe(true);
    const data = tx.managementAction.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "ACKNOWLEDGED", assignedToId: "m2", assignedById: "mgr1" });
    expect(data.assignedAt).toBeInstanceOf(Date);
    expect(tx.managementActionEvent.create.mock.calls[0][0].data).toMatchObject({ eventType: "ASSIGNED", assigneeId: "m2" });
    expect(tx.auditEvent.create.mock.calls[0][0].data.action).toBe("MANAGEMENT_ACTION_ASSIGNED");
  });

  it.each([
    ["a salesperson", { id: "s1", status: "ACTIVE", role: "SALESPERSON" }],
    ["an inactive manager", { id: "m3", status: "INACTIVE", role: "SALES_MANAGER" }],
    ["a missing user", null],
  ])("will not assign to %s", async (_label, user) => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    const result = await performManagementAction(request({ operation: "ASSIGN", assigneeId: "x" }), "mgr1");
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(tx.managementAction.updateMany).not.toHaveBeenCalled();
  });

  it("requires an assignee for an assign operation", async () => {
    expect(await performManagementAction(request({ operation: "ASSIGN" }), "mgr1")).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses to complete without a recorded outcome, and writes nothing", async () => {
    prismaMock.managementAction.findUnique.mockResolvedValue({ id: "a1" });
    state.row = { id: "a1", status: "IN_PROGRESS", assignedToId: "m2" };
    const result = await performManagementAction(request({ operation: "COMPLETE" }), "mgr1");
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(tx.managementAction.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("completes with an outcome note, stamping completedAt", async () => {
    prismaMock.managementAction.findUnique.mockResolvedValue({ id: "a1" });
    state.row = { id: "a1", status: "IN_PROGRESS", assignedToId: "m2" };
    const result = await performManagementAction(request({ operation: "COMPLETE", note: "Supplier raised the weekly order" }), "mgr1");
    expect(result.ok).toBe(true);
    const data = tx.managementAction.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "COMPLETED", statusNote: "Supplier raised the weekly order" });
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(tx.managementAction.upsert).not.toHaveBeenCalled();
  });

  it("will not start an action that has no owner", async () => {
    prismaMock.managementAction.findUnique.mockResolvedValue({ id: "a1" });
    state.row = { id: "a1", status: "ACKNOWLEDGED", assignedToId: null };
    expect(await performManagementAction(request({ operation: "START" }), "mgr1")).toMatchObject({ ok: false, status: 400 });
  });

  it("reports a conflict when someone else moved the action first", async () => {
    tx.managementAction.updateMany.mockResolvedValue({ count: 0 });
    const result = await performManagementAction(request(), "mgr1");
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(tx.managementActionEvent.create).not.toHaveBeenCalled();
  });

  it("can act on an existing action even if the finding has since disappeared", async () => {
    prismaMock.managementAction.findUnique.mockResolvedValue({ id: "a1" });
    vi.mocked(getReportIntelligence).mockResolvedValue({ reportId: "picking-shortages", findings: [], insufficientEvidence: [], noActionIndicated: true });
    state.row = { id: "a1", status: "ACKNOWLEDGED", assignedToId: null };
    const result = await performManagementAction(request({ operation: "DISMISS", note: "No longer relevant" }), "mgr1");
    expect(result.ok).toBe(true);
    expect(getReportIntelligence).not.toHaveBeenCalled();
  });
});
