import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 6B (Returns & Credit Notes). Read queries for the claim
 * detail page's returns/credit-notes sections, the credit-note
 * reconciliation queue (the UNMATCHED/CANNOT_LINK worklist, mirroring
 * Milestone 5's own unmatched-invoice-lines queue), and import-history
 * listing.
 */

export async function listClaimReturns(claimId: string) {
  return prisma.claimReturn.findMany({
    where: { claimId },
    include: {
      claimLine: { select: { id: true, sapInvoiceLine: { select: { sapItemCode: true, sapItemDescription: true } } } },
      receivedBy: { select: { id: true, name: true } },
      creditNote: { select: { id: true, sapCreditNoteDocNum: true, amount: true } },
    },
    orderBy: { receivedAt: "desc" },
  });
}

export async function listCreditNotesForClaim(claimId: string) {
  return prisma.creditNote.findMany({
    where: { claimId },
    include: {
      recordedBy: { select: { id: true, name: true } },
      matchedBy: { select: { id: true, name: true } },
      importBatch: { select: { id: true, originalFileName: true } },
    },
    orderBy: { recordedAt: "desc" },
  });
}

export type CreditNoteListFilters = {
  matchStatus?: string;
  claimId?: string;
  sapInvoiceId?: string;
  search?: string; // matches sapCreditNoteDocNum/sapCreditNoteDocEntry
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function clampPageSize(requested?: number): number {
  if (!requested || !Number.isFinite(requested) || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

/** The credit-note reconciliation queue -- defaults to no filter (every
 * credit note), but is primarily used filtered to matchStatus UNMATCHED
 * or CANNOT_LINK, same role Milestone 5's own unmatched-invoice-lines
 * list plays. */
export async function listCreditNotes(filters: CreditNoteListFilters, page: number, pageSize: number) {
  const where: Prisma.CreditNoteWhereInput = {
    ...(filters.matchStatus ? { matchStatus: filters.matchStatus as Prisma.CreditNoteWhereInput["matchStatus"] } : {}),
    ...(filters.claimId ? { claimId: filters.claimId } : {}),
    ...(filters.sapInvoiceId ? { sapInvoiceId: filters.sapInvoiceId } : {}),
    ...(filters.search
      ? {
          OR: [
            { sapCreditNoteDocNum: { contains: filters.search, mode: "insensitive" } },
            { sapCreditNoteDocEntry: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const safePageSize = clampPageSize(pageSize);
  const safePage = Math.max(1, page);

  const [rows, total] = await prisma.$transaction([
    prisma.creditNote.findMany({
      where,
      include: {
        sapInvoice: { select: { id: true, sapDocNum: true, currencyCode: true } },
        claim: { select: { id: true, claimReference: true, status: true } },
        recordedBy: { select: { id: true, name: true } },
        matchedBy: { select: { id: true, name: true } },
      },
      orderBy: { recordedAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.creditNote.count({ where }),
  ]);

  return { rows, total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
}

export async function getCreditNoteDetail(creditNoteId: string) {
  return prisma.creditNote.findUnique({
    where: { id: creditNoteId },
    include: {
      sapInvoice: { select: { id: true, sapDocNum: true, currencyCode: true, matchedCustomerId: true } },
      claim: { select: { id: true, claimReference: true, status: true } },
      recordedBy: { select: { id: true, name: true } },
      matchedBy: { select: { id: true, name: true } },
      importBatch: { select: { id: true, originalFileName: true, createdAt: true } },
      returns: { select: { id: true, returnReference: true, receivedQuantity: true } },
    },
  });
}

/**
 * Every claim raised against the same SAP invoice as this credit note --
 * used to populate the "match to claim" dropdown when a manager manually
 * resolves an UNMATCHED/CANNOT_LINK credit note. Returned regardless of
 * status (unlike the automatic matcher's narrower APPROVED/
 * PARTIALLY_RESOLVED-with-outstanding-exposure candidate set in
 * lib/returns-credits/match-credit-note.ts) so a human has full context
 * -- including a claim the automatic matcher would never offer -- before
 * making a judgment call the automatic matcher deliberately won't.
 */
export async function listClaimsForInvoice(sapInvoiceId: string) {
  return prisma.invoiceClaim.findMany({
    where: { sapInvoiceId },
    select: {
      id: true,
      claimReference: true,
      status: true,
      resolutions: {
        where: { approvedById: { not: null } },
        orderBy: { approvedAt: "desc" },
        take: 1,
        select: { decision: true, approvedCreditAmount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listCreditNoteImportBatches(page: number, pageSize: number) {
  const safePageSize = clampPageSize(pageSize);
  const safePage = Math.max(1, page);

  const [rows, total] = await prisma.$transaction([
    prisma.creditNoteImportBatch.findMany({
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.creditNoteImportBatch.count(),
  ]);

  return { rows, total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
}
