import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Final Operational Enhancements (spec Part 5). Read-only helpers for the
 * delivery-outcome workflow -- deliberately separate from
 * lib/invoice-reconciliation/queries.ts (Milestone 5's own module):
 * SAP's own reconciliationStatus on SapInvoice stays the single
 * authoritative accounting status; "Ready for Invoice" vs. "Delivered" is
 * a wholly separate, SalesFlow-only workflow status, DERIVED here from
 * whether an InvoiceDeliveryRecord exists -- never stored as a second
 * status column on SapInvoice itself ("derive, don't store a second
 * truth," same convention lib/invoice-reconciliation/reconcile.ts already
 * follows for its own authorized/invoiced/remaining figures).
 */

export type InvoiceDeliveryStatusValue = "READY_FOR_INVOICE" | "DELIVERED";

export const INVOICE_DELIVERY_STATUS_VALUES: readonly InvoiceDeliveryStatusValue[] = ["READY_FOR_INVOICE", "DELIVERED"];

/** Every SapInvoice id that already has an InvoiceDeliveryRecord -- used both to derive the per-invoice status below and to filter the /invoice-reconciliation list by it (lib/invoice-reconciliation/queries.ts's listSapInvoices). */
export async function getDeliveredSapInvoiceIds(): Promise<string[]> {
  const records = await prisma.invoiceDeliveryRecord.findMany({ select: { sapInvoiceId: true } });
  return records.map((record) => record.sapInvoiceId);
}

/** Batched (never N+1) delivery-status lookup for a page of invoice ids -- e.g. the reconciliation list's one page of rows. */
export async function getDeliveryStatusesForInvoiceIds(sapInvoiceIds: string[]): Promise<Map<string, InvoiceDeliveryStatusValue>> {
  const map = new Map<string, InvoiceDeliveryStatusValue>();
  if (sapInvoiceIds.length === 0) return map;
  const records = await prisma.invoiceDeliveryRecord.findMany({
    where: { sapInvoiceId: { in: sapInvoiceIds } },
    select: { sapInvoiceId: true },
  });
  const delivered = new Set(records.map((record) => record.sapInvoiceId));
  for (const id of sapInvoiceIds) {
    map.set(id, delivered.has(id) ? "DELIVERED" : "READY_FOR_INVOICE");
  }
  return map;
}

export type InvoiceDeliveryRecordDetail = {
  id: string;
  sapInvoiceId: string;
  outcome: string;
  podReference: string | null;
  notes: string | null;
  recordedById: string;
  recordedByName: string;
  recordedAt: string;
  claims: { id: string; claimReference: string; category: string; status: string; createdAt: string }[];
};

/** The full delivery-outcome record for one invoice, with its linked claims (if any) -- feeds the /invoice-reconciliation/[id] detail panel. Null when no outcome has been recorded yet (i.e. the invoice is still "Ready for Invoice"). */
export async function getInvoiceDeliveryRecord(sapInvoiceId: string): Promise<InvoiceDeliveryRecordDetail | null> {
  const record = await prisma.invoiceDeliveryRecord.findUnique({
    where: { sapInvoiceId },
    select: {
      id: true,
      sapInvoiceId: true,
      outcome: true,
      podReference: true,
      notes: true,
      recordedById: true,
      recordedBy: { select: { name: true } },
      recordedAt: true,
      claims: {
        select: { id: true, claimReference: true, category: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!record) return null;

  return {
    id: record.id,
    sapInvoiceId: record.sapInvoiceId,
    outcome: record.outcome,
    podReference: record.podReference,
    notes: record.notes,
    recordedById: record.recordedById,
    recordedByName: record.recordedBy.name,
    recordedAt: record.recordedAt.toISOString(),
    claims: record.claims.map((claim) => ({
      id: claim.id,
      claimReference: claim.claimReference,
      category: claim.category,
      status: claim.status,
      createdAt: claim.createdAt.toISOString(),
    })),
  };
}
