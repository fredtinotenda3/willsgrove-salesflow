import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 6A. Live-aggregate reads -- never a stored running total. One
 * SAP invoice line can have claim lines filed against it from MULTIPLE
 * claims over time (two separate complaints about the same line, weeks
 * apart), so "how much of this line is already claimed" is always
 * re-summed from InvoiceClaimLine at the moment it's needed, exactly the
 * same "derive, don't store a second truth" convention
 * lib/invoice-reconciliation/match-invoice.ts's getInvoicedQuantity()
 * established for "how much of this order line is already invoiced."
 */

export type AlreadyClaimedQuantity = {
  acceptedQuantity: string;
  rejectedQuantity: string;
};

/**
 * Sums accepted/rejected quantity across every OTHER claim line against
 * this SapInvoiceLine (optionally excluding one claim line id, so an
 * UPDATE to an existing line can validate against everyone else's totals
 * without double-counting itself).
 */
export async function getAlreadyClaimedQuantity(
  tx: Prisma.TransactionClient,
  sapInvoiceLineId: string,
  excludeClaimLineId?: string
): Promise<AlreadyClaimedQuantity> {
  const sum = await tx.invoiceClaimLine.aggregate({
    where: {
      sapInvoiceLineId,
      disputeType: "QUANTITY",
      ...(excludeClaimLineId ? { id: { not: excludeClaimLineId } } : {}),
    },
    _sum: { acceptedQuantity: true, rejectedQuantity: true },
  });

  return {
    acceptedQuantity: (sum._sum.acceptedQuantity ?? new Prisma.Decimal(0)).toString(),
    rejectedQuantity: (sum._sum.rejectedQuantity ?? new Prisma.Decimal(0)).toString(),
  };
}

/** Combined "already spoken for" quantity (accepted + rejected), as a decimal string. */
export async function getAlreadyClaimedTotal(
  tx: Prisma.TransactionClient,
  sapInvoiceLineId: string,
  excludeClaimLineId?: string
): Promise<string> {
  const { acceptedQuantity, rejectedQuantity } = await getAlreadyClaimedQuantity(tx, sapInvoiceLineId, excludeClaimLineId);
  // Both values came from the same @db.Decimal(18,4) column via Prisma.Decimal,
  // so plain Prisma.Decimal arithmetic here is exact -- no float drift.
  return new Prisma.Decimal(acceptedQuantity).plus(new Prisma.Decimal(rejectedQuantity)).toString();
}

export type InvoiceClaimListFilters = {
  status?: string;
  category?: string;
  priority?: string;
  customerId?: string;
  sapInvoiceId?: string;
  assignedToId?: string;
  search?: string; // matches claimReference or sapInvoice.sapDocNum
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function clampPageSize(requested?: number): number {
  if (!requested || !Number.isFinite(requested) || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

export async function listInvoiceClaims(filters: InvoiceClaimListFilters, page: number, pageSize: number) {
  const where: Prisma.InvoiceClaimWhereInput = {
    ...(filters.status ? { status: filters.status as Prisma.InvoiceClaimWhereInput["status"] } : {}),
    ...(filters.category ? { category: filters.category as Prisma.InvoiceClaimWhereInput["category"] } : {}),
    ...(filters.priority ? { priority: filters.priority as Prisma.InvoiceClaimWhereInput["priority"] } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.sapInvoiceId ? { sapInvoiceId: filters.sapInvoiceId } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.search
      ? {
          OR: [
            { claimReference: { contains: filters.search, mode: "insensitive" } },
            { sapInvoice: { sapDocNum: { contains: filters.search, mode: "insensitive" } } },
            { customerComplaintReference: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const safePageSize = clampPageSize(pageSize);
  const safePage = Math.max(1, page);

  const [rows, total] = await prisma.$transaction([
    prisma.invoiceClaim.findMany({
      where,
      include: {
        sapInvoice: { select: { id: true, sapDocNum: true, invoiceDate: true, currencyCode: true } },
        customer: { select: { id: true, name: true } },
        reportedBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        lines: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.invoiceClaim.count({ where }),
  ]);

  return { rows, total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
}

export async function getClaimDetail(claimId: string) {
  return prisma.invoiceClaim.findUnique({
    where: { id: claimId },
    include: {
      sapInvoice: {
        select: { id: true, sapDocNum: true, invoiceDate: true, currencyCode: true, matchedCustomerId: true, total: true },
      },
      order: { select: { id: true, reference: true } },
      customer: { select: { id: true, name: true, sapCustomerCode: true } },
      reportedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      lines: {
        include: {
          sapInvoiceLine: {
            select: {
              id: true,
              lineNumber: true,
              sapItemCode: true,
              sapItemDescription: true,
              quantityInvoiced: true,
              unitPrice: true,
              lineTotal: true,
              unitOfMeasure: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      resolutions: {
        include: {
          recordedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          rejectedBy: { select: { id: true, name: true } },
        },
        orderBy: { recordedAt: "desc" },
      },
      attachments: {
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { uploadedAt: "desc" },
      },
    },
  });
}

/** Every open (non-superseded) claim line raised against one SAP invoice, across all claims -- used by the create-claim form to show "already claimed" context before submission. */
export async function listClaimLinesForInvoiceLine(sapInvoiceLineId: string) {
  return prisma.invoiceClaimLine.findMany({
    where: { sapInvoiceLineId },
    select: {
      id: true,
      claimId: true,
      disputeType: true,
      acceptedQuantity: true,
      rejectedQuantity: true,
      disputedAmount: true,
      claim: { select: { claimReference: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
