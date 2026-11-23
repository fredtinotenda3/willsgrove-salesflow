import { describe, expect, it } from "vitest";
import { buildAssignmentHistory, collectAssignmentIds, type AssignmentEventRow } from "@/lib/fulfilment/assignment-history";
import { changeDispatchAssignmentSchema } from "@/lib/fulfilment/validation";

const lookup = {
  personnel: new Map([["p1", "Tendai"], ["p2", "Farai"], ["p3", "Rudo"]]),
  vehicles: new Map([["v1", "ABC 123"], ["v2", "XYZ 789"]]),
};

const events: AssignmentEventRow[] = [
  {
    id: "e2",
    dispatchRecordId: "d1",
    action: "DISPATCH_ASSIGNMENT_CHANGED",
    createdAt: new Date("2026-03-02T10:00:00Z"),
    actorName: "Admin",
    beforeData: { driverId: "p1", assistantId: "p3", vehicleId: "v1" },
    afterData: { driverId: "p2", assistantId: "p3", vehicleId: "v2", reason: "Breakdown" },
  },
  {
    id: "e1",
    dispatchRecordId: "d1",
    action: "DISPATCH_RECORD_CREATED",
    createdAt: new Date("2026-03-02T08:00:00Z"),
    actorName: "Clerk",
    beforeData: null,
    afterData: { driverId: "p1", assistantId: "p3", vehicleId: "v1" },
  },
  { id: "x", dispatchRecordId: "d1", action: "OTHER", createdAt: new Date("2026-03-02T09:00:00Z"), actorName: null, beforeData: null, afterData: {} },
];

describe("buildAssignmentHistory", () => {
  const history = buildAssignmentHistory(events, lookup).get("d1")!;

  it("orders oldest first and ignores unrelated events", () => {
    expect(history.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(history[0].kind).toBe("ASSIGNED");
    expect(history[1].kind).toBe("CHANGED");
  });

  it("resolves names and records only the fields that actually changed", () => {
    expect(history[1].previous).toEqual({ driver: "Tendai", assistant: "Rudo", vehicle: "ABC 123" });
    expect(history[1].current).toEqual({ driver: "Farai", assistant: "Rudo", vehicle: "XYZ 789" });
    expect(history[1].changed).toEqual(["driver", "vehicle"]);
    expect(history[1].reason).toBe("Breakdown");
    expect(history[1].byName).toBe("Admin");
  });

  it("leaves unknown names null instead of inventing them", () => {
    const h = buildAssignmentHistory([events[1]], { personnel: new Map(), vehicles: new Map() }).get("d1")!;
    expect(h[0].current).toEqual({ driver: null, assistant: null, vehicle: null });
  });
});

describe("collectAssignmentIds", () => {
  it("gathers every personnel and vehicle id from before and after data", () => {
    const ids = collectAssignmentIds(events);
    expect(ids.personnelIds.sort()).toEqual(["p1", "p2", "p3"]);
    expect(ids.vehicleIds.sort()).toEqual(["v1", "v2"]);
  });
});

describe("changeDispatchAssignmentSchema", () => {
  it("requires a reason and at least one new id", () => {
    expect(changeDispatchAssignmentSchema.safeParse({ driverId: "p1", reason: "  " }).success).toBe(false);
    expect(changeDispatchAssignmentSchema.safeParse({ reason: "Because" }).success).toBe(false);
    expect(changeDispatchAssignmentSchema.safeParse({ vehicleId: "v1", reason: "Because" }).success).toBe(true);
  });
});
