import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CLAIM_LINE_REASON_CATEGORY_LABELS, type AnyStoredClaimLineReasonCategory } from "@/lib/invoice-claims/validation";
import { deriveClaimFacet, deriveReturnFacet, sumQuantities, type ClaimFacet, type ReturnFacet } from "@/lib/invoice-claims/invoice-claim-state";

/**
 * Invoice Claims register: EVERY invoice generated inside SalesFlow
 * (SapInvoice rows written by native recording, rawSourceData.source =
 * "NATIVE_RECORDING"), whether or not a claim exists, so "no claim" is a
 * visible outcome rather than an absence. Claims are linked back to the
 * original invoice, its customer order and the relevant lines; no SAP
 * invoice id is involved. Claim exposure (disputed/rejected quantity) is
 * reported separately from confirmed losses, which remain the existing
 * returned-product valuation's job.
 */
export type InvoiceRegisterFilter = { search?: string; customerId?: string; claim?: "all" | "none" | "with" };

export type InvoiceRegisterRow = {
  invoiceId: string;
  invoiceReference: string;
  invoiceDate: string | null;
  customerId: string | null;
  customerName: string | null;
  orderId: string | null;
  orderReference: string | null;
  currencyCode: string | null;
  total: string | null;
  invoicedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  returnedQuantity: string;
  claimFacet: ClaimFacet;
  returnFacet: ReturnFacet;
  claims: {
    id: string;
    claimReference: string;
    status: string;
    lines: { description: string | null; sapItemCode: string | null; reasonLabel: string | null; acceptedQuantity: string | null; rejectedQuantity: string | null }[];
  }[];
};

export async function listInvoiceRegister(filter: InvoiceRegisterFilter, page: number, pageSize: number) {
  const where: Prisma.SapInvoiceWhereInput = {
    isDemo: false,
    rawSourceData: { path: ["source"], equals: "NATIVE_RECORDING" },
    ...(filter.customerId ? { matchedCustomerId: filter.customerId } : {}),
    ...(filter.claim === "none" ? { claims: { none: {} } } : {}),
    ...(filter.claim === "with" ? { claims: { some: {} } } : {}),
    ...(filter.search
      ? {
          OR: [
            { sapDocNum: { contains: filter.search, mode: "insensitive" } },
            { customerName: { contains: filter.search, mode: "insensitive" } },
            { matchedCustomer: { name: { contains: filter.search, mode: "insensitive" } } },
            { matchedOrder: { reference: { contains: filter.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, invoices] = await Promise.all([
    prisma.sapInvoice.count({ where }),
    prisma.sapInvoice.findMany({
      where,
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        sapDocNum: true,
        invoiceDate: true,
        currencyCode: true,
        total: true,
        customerName: true,
        matchedCustomer: { select: { id: true, name: true } },
        matchedOrder: { select: { id: true, reference: true } },
        lines: { select: { quantityInvoiced: true } },
        claims: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            claimReference: true,
            status: true,
            lines: {
              select: { sapItemCodeSnapshot: true, sapItemDescriptionSnapshot: true, reasonCategory: true, acceptedQuantity: true, rejectedQuantity: true },
            },
            returns: { select: { receivedQuantity: true } },
          },
        },
      },
    }),
  ]);

  const rows: InvoiceRegisterRow[] = invoices.map((invoice) => {
    const invoicedQuantity = sumQuantities(invoice.lines.map((l) => l.quantityInvoiced.toString()));
    const allClaimLines = invoice.claims.flatMap((c) => c.lines);
    const acceptedQuantity = sumQuantities(allClaimLines.map((l) => l.acceptedQuantity?.toString()));
    const rejectedQuantity = sumQuantities(allClaimLines.map((l) => l.rejectedQuantity?.toString()));
    const returnedQuantity = sumQuantities(invoice.claims.flatMap((c) => c.returns.map((r) => r.receivedQuantity.toString())));
    return {
      invoiceId: invoice.id,
      invoiceReference: invoice.sapDocNum,
      invoiceDate: invoice.invoiceDate?.toISOString() ?? null,
      customerId: invoice.matchedCustomer?.id ?? null,
      customerName: invoice.matchedCustomer?.name ?? invoice.customerName,
      orderId: invoice.matchedOrder?.id ?? null,
      orderReference: invoice.matchedOrder?.reference ?? null,
      currencyCode: invoice.currencyCode,
      total: invoice.total?.toString() ?? null,
      invoicedQuantity,
      acceptedQuantity,
      rejectedQuantity,
      returnedQuantity,
      claimFacet: deriveClaimFacet(invoice.claims.map((c) => c.status)),
      returnFacet: deriveReturnFacet(returnedQuantity, invoicedQuantity),
      claims: invoice.claims.map((claim) => ({
        id: claim.id,
        claimReference: claim.claimReference,
        status: claim.status,
        lines: claim.lines.map((line) => ({
          description: line.sapItemDescriptionSnapshot,
          sapItemCode: line.sapItemCodeSnapshot,
          reasonLabel: line.reasonCategory ? CLAIM_LINE_REASON_CATEGORY_LABELS[line.reasonCategory as AnyStoredClaimLineReasonCategory] ?? line.reasonCategory : null,
          acceptedQuantity: line.acceptedQuantity?.toString() ?? null,
          rejectedQuantity: line.rejectedQuantity?.toString() ?? null,
        })),
      })),
    };
  });

  return { rows, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
