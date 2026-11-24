/**
 * Administration policy (pure -- no database, no Prisma import).
 *
 * The invariants here are code, not configuration: who may be an assignee,
 * which records may be reassigned, and the last-administrator rule. They are
 * unit-tested in tests/admin-policy.test.ts and enforced again by the
 * server services inside their transactions.
 */

export type RoleName = "SALESPERSON" | "SALES_MANAGER" | "ADMINISTRATOR";
export type RecordStatusName = "ACTIVE" | "INACTIVE";

/** Strictly: a user may receive work only while ACTIVE. */
export function isEligibleAssignee(user: { status: RecordStatusName } | null | undefined): boolean {
  return !!user && user.status === "ACTIVE";
}

/**
 * Orders whose salesperson may be reassigned. Anything from first receipt up
 * to (not including) invoicing. READY_TO_INVOICE, REJECTED and CANCELLED are
 * closed for ownership change: the person who owned an order when it was
 * invoiced or ended stays on the record (history protection).
 */
export const REASSIGNABLE_ORDER_STATUSES = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] as const;

export function isReassignableOrderStatus(status: string): boolean {
  return (REASSIGNABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Quotations still in play. ACCEPTED/REJECTED/EXPIRED/CANCELLED and converted/superseded ones keep their owner. */
export const REASSIGNABLE_QUOTATION_STATUSES = ["DRAFT", "ISSUED"] as const;

export function isReassignableQuotation(q: { status: string; convertedOrderId: string | null; supersededAt: Date | null }): boolean {
  return (REASSIGNABLE_QUOTATION_STATUSES as readonly string[]).includes(q.status) && !q.convertedOrderId && !q.supersededAt;
}

/** Claims that may change owner: not yet concluded. */
export const CONCLUDED_CLAIM_STATUSES = ["RESOLVED", "REJECTED", "CLOSED"] as const;

export function isReassignableClaimStatus(status: string): boolean {
  return !(CONCLUDED_CLAIM_STATUSES as readonly string[]).includes(status);
}

export type AdminChangeCheck = { ok: true } | { ok: false; message: string };

/**
 * The last active administrator may not be deactivated or demoted -- and
 * no administrator may do either to themselves (existing rule kept).
 */
export function checkAdministratorContinuity(args: {
  actorId: string;
  target: { id: string; role: RoleName; status: RecordStatusName };
  next: { role: RoleName; status: RecordStatusName };
  otherActiveAdministrators: number;
}): AdminChangeCheck {
  const { target, next, actorId } = args;
  const wasActiveAdmin = target.role === "ADMINISTRATOR" && target.status === "ACTIVE";
  const staysActiveAdmin = next.role === "ADMINISTRATOR" && next.status === "ACTIVE";
  if (!wasActiveAdmin || staysActiveAdmin) return { ok: true };
  if (target.id === actorId) {
    return { ok: false, message: next.status === "INACTIVE" ? "You cannot deactivate your own account." : "You cannot remove your own administrator role." };
  }
  if (args.otherActiveAdministrators < 1) return { ok: false, message: "This is the last active administrator. Another administrator must be active first." };
  return { ok: true };
}

export const MIN_REASON_LENGTH = 3;

export function normaliseReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim().replace(/\s+/g, " ");
  return trimmed.length >= MIN_REASON_LENGTH && trimmed.length <= 500 ? trimmed : null;
}

/** Duplicate detection key for product barcodes and customer names: case-, space- and punctuation-insensitive. */
export function duplicateKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const BULK_REASSIGN_LIMIT = 500;
