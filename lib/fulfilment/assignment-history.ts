/**
 * Builds a dispatch's assignment history (who drove, who assisted, which
 * vehicle -- and every later change to them) out of the AuditEvent rows
 * lib/fulfilment/dispatch.ts writes: DISPATCH_RECORD_CREATED (the initial
 * assignment) and DISPATCH_ASSIGNMENT_CHANGED (each change, with before/after
 * values and a reason).
 *
 * Pure logic, no database access, so it is unit-testable and safe to import
 * anywhere. It never invents history: an entry exists only for an event that
 * was actually recorded. Dispatches created before assignments were
 * snapshotted by name carry ids only in their creation event; those are
 * resolved through the caller-supplied id -> name maps and, if still unknown,
 * left as null (the UI renders "Not Available") -- never guessed.
 */

export const ASSIGNMENT_EVENT_ACTIONS = ["DISPATCH_RECORD_CREATED", "DISPATCH_ASSIGNMENT_CHANGED"] as const;

export type AssignmentEventRow = {
  id: string;
  dispatchRecordId: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
  beforeData: unknown;
  afterData: unknown;
};

export type AssignmentSnapshot = {
  driver: string | null;
  assistant: string | null;
  vehicle: string | null;
};

export type AssignmentHistoryEntry = {
  id: string;
  at: string;
  byName: string | null;
  kind: "ASSIGNED" | "CHANGED";
  /** The assignment in force after this event. */
  current: AssignmentSnapshot;
  /** The assignment before this event (CHANGED only). */
  previous: AssignmentSnapshot | null;
  /** Which of driver/assistant/vehicle this event changed (CHANGED only). */
  changed: (keyof AssignmentSnapshot)[];
  reason: string | null;
};

export type AssignmentNameLookup = {
  personnel: ReadonlyMap<string, string>;
  vehicles: ReadonlyMap<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Every personnel/vehicle id mentioned by these events -- so the caller can resolve names in two queries. */
export function collectAssignmentIds(events: AssignmentEventRow[]): { personnelIds: string[]; vehicleIds: string[] } {
  const personnel = new Set<string>();
  const vehicles = new Set<string>();
  for (const event of events) {
    for (const data of [asRecord(event.beforeData), asRecord(event.afterData)]) {
      if (!data) continue;
      const driverId = str(data.driverId);
      const assistantId = str(data.assistantId);
      const vehicleId = str(data.vehicleId);
      if (driverId) personnel.add(driverId);
      if (assistantId) personnel.add(assistantId);
      if (vehicleId) vehicles.add(vehicleId);
    }
  }
  return { personnelIds: [...personnel], vehicleIds: [...vehicles] };
}

function snapshotFrom(data: Record<string, unknown> | null, lookup: AssignmentNameLookup): AssignmentSnapshot {
  if (!data) return { driver: null, assistant: null, vehicle: null };
  const driverId = str(data.driverId);
  const assistantId = str(data.assistantId);
  const vehicleId = str(data.vehicleId);
  return {
    driver: str(data.driverName) ?? (driverId ? (lookup.personnel.get(driverId) ?? null) : null),
    assistant: str(data.assistantName) ?? (assistantId ? (lookup.personnel.get(assistantId) ?? null) : null),
    vehicle: str(data.vehicleRegistration) ?? (vehicleId ? (lookup.vehicles.get(vehicleId) ?? null) : null),
  };
}

/** Entries per dispatch record id, oldest first. Events of any other action are ignored. */
export function buildAssignmentHistory(
  events: AssignmentEventRow[],
  lookup: AssignmentNameLookup
): Map<string, AssignmentHistoryEntry[]> {
  const byDispatch = new Map<string, AssignmentHistoryEntry[]>();
  const sorted = events
    .filter((event) => (ASSIGNMENT_EVENT_ACTIONS as readonly string[]).includes(event.action))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const event of sorted) {
    const after = asRecord(event.afterData);
    const current = snapshotFrom(after, lookup);

    let entry: AssignmentHistoryEntry;
    if (event.action === "DISPATCH_RECORD_CREATED") {
      entry = {
        id: event.id,
        at: event.createdAt.toISOString(),
        byName: event.actorName,
        kind: "ASSIGNED",
        current,
        previous: null,
        changed: [],
        reason: null,
      };
    } else {
      const previous = snapshotFrom(asRecord(event.beforeData), lookup);
      // Change detection is by id (authoritative); the display names are only for show.
      const beforeRecord = asRecord(event.beforeData);
      const idChanged = (key: "driverId" | "assistantId" | "vehicleId") => str(beforeRecord?.[key]) !== str(after?.[key]);
      const changed: (keyof AssignmentSnapshot)[] = [];
      if (idChanged("driverId")) changed.push("driver");
      if (idChanged("assistantId")) changed.push("assistant");
      if (idChanged("vehicleId")) changed.push("vehicle");
      entry = {
        id: event.id,
        at: event.createdAt.toISOString(),
        byName: event.actorName,
        kind: "CHANGED",
        current,
        previous,
        changed,
        reason: str(after?.reason),
      };
    }

    const list = byDispatch.get(event.dispatchRecordId) ?? [];
    list.push(entry);
    byDispatch.set(event.dispatchRecordId, list);
  }

  return byDispatch;
}
