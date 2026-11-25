/**
 * The explicit deletion policy: for every manageable entity, what an
 * administrator may do to remove or retire a record. Pure data, so it is the
 * single reference for the UI (no misleading delete buttons), the README and
 * the tests. "Immutable" and "business transaction" entities have NO delete
 * route at all.
 */
export type PolicyKind = "HARD_DELETE_IF_UNREFERENCED" | "SOFT_DELETE" | "ARCHIVE" | "DEACTIVATE" | "IMMUTABLE" | "BUSINESS_TRANSACTION";

export type EntityPolicy = { entity: string; kinds: PolicyKind[]; summary: string; alternative: string };

export const DELETION_POLICY: EntityPolicy[] = [
  { entity: "Order", kinds: ["HARD_DELETE_IF_UNREFERENCED", "ARCHIVE"], summary: "An unreferenced DRAFT may be deleted (lines and status history go with it; a snapshot stays in the audit log). Every other order is retained.", alternative: "Cancel with a reason (and reopen if it never reached SAP)." },
  { entity: "Order line", kinds: ["BUSINESS_TRANSACTION"], summary: "Lines carry verification, price decisions, picking and invoice links.", alternative: "Corrected through the order workflow, never from administration." },
  { entity: "Quotation", kinds: ["ARCHIVE", "BUSINESS_TRANSACTION"], summary: "Quotations and every revision are retained for traceability.", alternative: "Cancel or expire through the quotation lifecycle." },
  { entity: "Customer", kinds: ["HARD_DELETE_IF_UNREFERENCED", "DEACTIVATE"], summary: "Deleted only when nothing in the system refers to it (no orders, quotations, invoices, claims, messages). Otherwise deactivated.", alternative: "Deactivate; SAP customer code and history stay intact." },
  { entity: "Product", kinds: ["HARD_DELETE_IF_UNREFERENCED", "ARCHIVE"], summary: "Deleted only when never used on an order, quotation, price list, stock snapshot or demand record. Otherwise archived.", alternative: "Archive (INACTIVE) and restore at any time." },
  { entity: "Product alias", kinds: ["HARD_DELETE_IF_UNREFERENCED"], summary: "A learned text-to-product mapping, not a transaction; safe to remove.", alternative: "Re-learned automatically if a reviewer confirms the match again." },
  { entity: "Price list", kinds: ["HARD_DELETE_IF_UNREFERENCED", "DEACTIVATE"], summary: "Deleted only when it has no entries and no customer uses it.", alternative: "Deactivate; historical order and quotation prices are never rewritten." },
  { entity: "Price list entry", kinds: ["HARD_DELETE_IF_UNREFERENCED"], summary: "Removing an entry never changes prices already snapshotted on orders or quotations.", alternative: "Set an end date instead of removing." },
  { entity: "User", kinds: ["DEACTIVATE"], summary: "Users are referenced by orders, audit events, approvals and more, so they are never deleted.", alternative: "Reassign their work, then deactivate." },
  { entity: "Driver / assistant / vehicle", kinds: ["HARD_DELETE_IF_UNREFERENCED", "DEACTIVATE"], summary: "Deleted only when never used on a dispatch.", alternative: "Deactivate; delivery history stays complete." },
  { entity: "SAP invoice, lines and import batch", kinds: ["IMMUTABLE", "BUSINESS_TRANSACTION"], summary: "Imported financial evidence. Never edited or deleted from administration.", alternative: "Re-run matching, record a manual match, or mark a line 'cannot link' with a note." },
  { entity: "Invoice claim, resolution, attachment", kinds: ["IMMUTABLE", "BUSINESS_TRANSACTION"], summary: "Financial records. Status changes only through the validated claim workflow.", alternative: "Assign, investigate, resolve or reject through the claim workflow." },
  { entity: "Credit note and return", kinds: ["IMMUTABLE", "BUSINESS_TRANSACTION"], summary: "Financial records matched to invoices and claims.", alternative: "Re-match, mark 'cannot link' or reopen through the credit-note workflow." },
  { entity: "Dispatch and delivery record", kinds: ["IMMUTABLE", "BUSINESS_TRANSACTION"], summary: "Delivery history.", alternative: "Cancel a planned dispatch or record the outcome through fulfilment." },
  { entity: "Stock snapshot", kinds: ["IMMUTABLE"], summary: "Imported point-in-time evidence; not live inventory.", alternative: "Import a newer snapshot." },
  { entity: "Integration job and operation", kinds: ["IMMUTABLE", "BUSINESS_TRANSACTION"], summary: "Sync history and outbox evidence.", alternative: "Retry, reconcile or resolve through the integration workflow." },
  { entity: "Message intake and outbound message", kinds: ["IMMUTABLE", "BUSINESS_TRANSACTION"], summary: "Communication history.", alternative: "Ignore, link, convert or resend through the communications workflow." },
  { entity: "Audit event", kinds: ["IMMUTABLE"], summary: "Never edited or deleted through the application.", alternative: "Export for archival." },
  { entity: "System setting override", kinds: ["SOFT_DELETE"], summary: "Reset restores the built-in default; the change is audited.", alternative: "Reset to default." },
];

export type Blocker = { label: string; count: number };

/** Turns dependency counts into the blockers that stop a delete. Zero counts are ignored. */
export function blockersFrom(counts: Record<string, number>, labels: Record<string, string>): Blocker[] {
  return Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => ({ label: labels[k] ?? k, count: n }));
}

export const describeBlockers = (blockers: Blocker[]): string => blockers.map((b) => `${b.count} ${b.label}`).join(", ");

export type DeleteVerdict = { deletable: true } | { deletable: false; reason: string; blockers: Blocker[] };

const verdict = (blockers: Blocker[], lead: string): DeleteVerdict => (blockers.length === 0 ? { deletable: true } : { deletable: false, blockers, reason: `${lead} ${describeBlockers(blockers)}.` });

/* ------------------------------ order ------------------------------ */

export type OrderDeleteFacts = {
  status: string;
  handedToSapAt: Date | null;
  invoicedAt: Date | null;
  counts: { documents: number; approvals: number; approvalRequests: number; pickingSessions: number; handovers: number; dispatchRecords: number; matchedInvoices: number; matchedInvoiceLines: number; claims: number; demands: number; integrationOperations: number; messageIntakes: number; outboundMessages: number; recommendations: number; sourceQuotations: number; verifications: number; priceDecisions: number };
};

export const ORDER_DEPENDENCY_LABELS: Record<string, string> = {
  documents: "uploaded document(s)", approvals: "approval record(s)", approvalRequests: "approval request(s)", pickingSessions: "picking session(s)", handovers: "invoice hand-over(s)", dispatchRecords: "dispatch record(s)",
  matchedInvoices: "matched SAP invoice(s)", matchedInvoiceLines: "matched invoice line(s)", claims: "invoice claim(s)", demands: "lost-sale / unfulfilled-demand record(s)", integrationOperations: "SAP integration operation(s)",
  messageIntakes: "linked inbound message(s)", outboundMessages: "outbound message(s)", recommendations: "management recommendation(s)", sourceQuotations: "source quotation(s)", verifications: "product verification(s)", priceDecisions: "price decision(s)",
};

/** Only a DRAFT with no downstream trace may be hard-deleted. The caller re-checks this inside the delete transaction. */
export function checkOrderDeletable(f: OrderDeleteFacts): DeleteVerdict {
  if (f.status !== "DRAFT") return { deletable: false, reason: `Only DRAFT orders can be deleted. This order is ${f.status.replace(/_/g, " ")}; cancel it instead so the history is kept.`, blockers: [] };
  if (f.handedToSapAt || f.invoicedAt) return { deletable: false, reason: "This order has been handed to SAP or invoiced and must be retained.", blockers: [] };
  return verdict(blockersFrom(f.counts, ORDER_DEPENDENCY_LABELS), "This draft is referenced by");
}

/* ----------------------------- generic ----------------------------- */

export const CUSTOMER_DEPENDENCY_LABELS: Record<string, string> = { orders: "order(s)", quotations: "quotation(s)", invoices: "SAP invoice(s)", claims: "claim(s)", demands: "demand record(s)", intakes: "inbound message(s)", outbound: "outbound message(s)", recommendations: "recommendation(s)", returnLostSales: "return lost-sale record(s)" };
export const checkCustomerDeletable = (counts: Record<string, number>): DeleteVerdict => verdict(blockersFrom(counts, CUSTOMER_DEPENDENCY_LABELS), "This customer is referenced by");

export const PRODUCT_DEPENDENCY_LABELS: Record<string, string> = { orderLines: "order line(s)", quotationLines: "quotation line(s)", priceEntries: "price-list entry(ies)", stockLines: "stock snapshot line(s)", demands: "demand record(s)", extractedLines: "extracted order line(s)", recommendations: "recommendation(s)", substituteEvents: "substitute decision(s)" };
export const checkProductDeletable = (counts: Record<string, number>): DeleteVerdict => verdict(blockersFrom(counts, PRODUCT_DEPENDENCY_LABELS), "This product is referenced by");

export const PRICE_LIST_DEPENDENCY_LABELS: Record<string, string> = { entries: "price entry(ies)", customers: "customer(s) assigned" };
export const checkPriceListDeletable = (counts: Record<string, number>): DeleteVerdict => verdict(blockersFrom(counts, PRICE_LIST_DEPENDENCY_LABELS), "This price list still has");
