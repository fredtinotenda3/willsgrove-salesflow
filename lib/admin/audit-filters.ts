export type AuditFilters = { q?: string; actorId?: string; entityType?: string; action?: string; from?: Date; to?: Date };

const clean = (v: unknown, max = 100) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const date = (v: unknown, endOfDay: boolean) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Pure: raw query params -> typed filters (junk values are dropped, never passed to the database). */
export function parseAuditFilters(raw: Record<string, unknown>): AuditFilters {
  return { q: clean(raw.q), actorId: clean(raw.actor, 64), entityType: clean(raw.entity), action: clean(raw.action), from: date(raw.from, false), to: date(raw.to, true) };
}
