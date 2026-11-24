/** Pure order and price-entry rules (no Prisma). Kept separate from policy.ts. */
import type { AdminChangeCheck } from "./policy";

/* ------------------------------- orders ------------------------------- */

export type OrderGuardFacts = {
  status: string;
  handedToSapAt: Date | null;
  invoicedAt: Date | null;
  pickingSessions: number;
  pendingApprovals: number;
  invoiceMatches: number;
};

/** Correctable details (PO reference, delivery date/address, notes) until the order is approved. Never after fulfilment starts. */
export const EDITABLE_ORDER_STATUSES = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED"] as const;

export function checkOrderEditable(o: OrderGuardFacts): AdminChangeCheck {
  if (!(EDITABLE_ORDER_STATUSES as readonly string[]).includes(o.status)) return { ok: false, message: `Orders in status ${o.status.replace(/_/g, " ")} can no longer be edited.` };
  if (o.handedToSapAt || o.invoicedAt || o.invoiceMatches > 0) return { ok: false, message: "This order has been handed to SAP or invoiced and is protected." };
  return { ok: true };
}

/** Cancel only before fulfilment, SAP hand-over and invoicing, and with no approval still pending (withdraw it first). */
export function checkOrderCancellable(o: OrderGuardFacts): AdminChangeCheck {
  const editable = checkOrderEditable(o);
  if (!editable.ok) return { ok: false, message: editable.message.replace("edited", "cancelled") };
  if (o.pickingSessions > 0) return { ok: false, message: "Picking has started for this order. Finish or authorise the picking session first." };
  if (o.pendingApprovals > 0) return { ok: false, message: "An approval request is still pending. Withdraw or decide it first." };
  return { ok: true };
}

/** A cancelled or rejected order may be reopened (back to RECEIVED) only if it never reached SAP or invoicing. */
export function checkOrderReopenable(o: OrderGuardFacts): AdminChangeCheck {
  if (o.status !== "CANCELLED" && o.status !== "REJECTED") return { ok: false, message: "Only cancelled or rejected orders can be reopened." };
  if (o.handedToSapAt || o.invoicedAt || o.invoiceMatches > 0) return { ok: false, message: "This order reached SAP or invoicing and cannot be reopened." };
  return { ok: true };
}

/* ------------------------------ price lists ---------------------------- */

export type PriceEntryLike = { id: string; sapItemCode: string; unitPrice: string; validFrom: Date; validTo: Date | null };
export type PriceEntryState = "current" | "expired" | "future" | "conflict";

/** Two validity windows overlap when each starts before the other ends (null end = open-ended). */
export function windowsOverlap(a: { validFrom: Date; validTo: Date | null }, b: { validFrom: Date; validTo: Date | null }): boolean {
  const aEndsAfterBStarts = a.validTo === null || a.validTo.getTime() >= b.validFrom.getTime();
  const bEndsAfterAStarts = b.validTo === null || b.validTo.getTime() >= a.validFrom.getTime();
  return aEndsAfterBStarts && bEndsAfterAStarts;
}

/** Labels each entry; "conflict" = another entry for the same SAP code overlaps in time (ambiguous price). */
export function classifyPriceEntries(entries: PriceEntryLike[], now: Date): Map<string, PriceEntryState> {
  const out = new Map<string, PriceEntryState>();
  const byCode = new Map<string, PriceEntryLike[]>();
  for (const e of entries) byCode.set(e.sapItemCode, [...(byCode.get(e.sapItemCode) ?? []), e]);
  for (const e of entries) {
    const clash = (byCode.get(e.sapItemCode) ?? []).some((o) => o.id !== e.id && windowsOverlap(e, o));
    if (clash) out.set(e.id, "conflict");
    else if (e.validTo && e.validTo.getTime() < now.getTime()) out.set(e.id, "expired");
    else if (e.validFrom.getTime() > now.getTime()) out.set(e.id, "future");
    else out.set(e.id, "current");
  }
  return out;
}

/** Exact positive decimal (max 4 dp) as a string -- prices are never held as floats. */
export function isValidPriceString(v: string): boolean {
  return /^\d{1,14}(\.\d{1,4})?$/.test(v) && Number(v) > 0;
}
