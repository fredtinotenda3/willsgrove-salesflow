import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS, isUniqueViolation } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { computeQuotationLineAmounts, computeQuotationTotals, type QuotationLineAmounts } from "@/lib/quotations/calculations";
import {
  type CreateQuotationInput,
  type QuotationLineInput,
  validatePositiveQuantity,
  validateValidityWindow,
} from "@/lib/quotations/validation";

/**
 * Milestone 7. Any authenticated user may create a quotation (same "no
 * dedicated role" convention as order creation -- app/api/orders/
 * route.ts has no role gate either). Role-agnostic function; the route
 * layer (app/api/quotations/route.ts) only checks the caller is
 * authenticated at all.
 */

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type CreateQuotationResult = { ok: true; id: string; quotationNumber: string } | MutationFailure;

/** Same `PREFIX-YYYYMMDD-8HEX` shape as generateOrderReference()/generateClaimReference(). */
export function generateQuotationNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `QUO-${datePart}-${randomPart}`;
}

type ResolvedLine = {
  input: QuotationLineInput;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  sapItemDescriptionSnapshot: string | null;
  unitOfMeasure: string | null;
  vatCodeSnapshot: string | null;
  vatRatePercentSnapshot: string | null;
  amounts: QuotationLineAmounts;
};

/**
 * Resolves and validates every line's product reference, snapshots its
 * SAP identity/VAT code, and computes its money amounts -- all BEFORE
 * any database write, so a bad line fails fast with a specific field
 * error rather than a transaction rollback. Shared between createQuotation
 * (below) and lib/quotations/edit.ts's line-level mutations so the two
 * never validate/snapshot/calculate a line differently.
 */
export async function resolveQuotationLines(
  lines: QuotationLineInput[]
): Promise<{ ok: true; lines: ResolvedLine[] } | MutationFailure> {
  const productIds = [...new Set(lines.filter((l) => !l.isUnlistedItem).map((l) => l.productId as string))];
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sapItemCode: true, itemName: true, unitOfMeasure: true, vatCode: true },
        })
      : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const vatCodes = [...new Set(products.map((p) => p.vatCode).filter((c): c is string => Boolean(c)))];
  const taxCodes = vatCodes.length > 0 ? await prisma.taxCode.findMany({ where: { code: { in: vatCodes } }, select: { code: true, ratePercent: true } }) : [];
  const taxRateByCode = new Map(taxCodes.map((t) => [t.code, t.ratePercent.toString()]));

  const resolved: ResolvedLine[] = [];

  for (const [index, line] of lines.entries()) {
    const quantityCheck = validatePositiveQuantity(line.quantity);
    if (!quantityCheck.ok) {
      return { ok: false, status: 400, message: quantityCheck.message, fieldErrors: { [`lines.${index}.quantity`]: quantityCheck.message } };
    }

    let productId: string | null = null;
    let sapItemCodeSnapshot: string | null = null;
    let sapItemDescriptionSnapshot: string | null = null;
    let unitOfMeasure = line.unitOfMeasure ?? null;
    let vatCodeSnapshot: string | null = null;
    let vatRatePercentSnapshot: string | null = null;

    if (line.isUnlistedItem) {
      if (!line.unlistedItemDescription?.trim()) {
        return {
          ok: false,
          status: 400,
          message: "unlistedItemDescription is required for an unlisted/requested item.",
          fieldErrors: { [`lines.${index}.unlistedItemDescription`]: "Required for an unlisted item." },
        };
      }
    } else {
      const product = productById.get(line.productId as string);
      if (!product) {
        return {
          ok: false,
          status: 404,
          message: `Product not found for line ${index + 1}.`,
          fieldErrors: { [`lines.${index}.productId`]: "Product not found." },
        };
      }
      productId = product.id;
      sapItemCodeSnapshot = product.sapItemCode;
      sapItemDescriptionSnapshot = product.itemName;
      unitOfMeasure = line.unitOfMeasure ?? product.unitOfMeasure ?? null;
      // Spec: "never invent missing SAP fields" -- a vatCode that doesn't
      // (yet) resolve to a known TaxCode is left null, never defaulted to
      // 0%, so the UI can distinguish "no VAT" from "VAT not yet known."
      vatCodeSnapshot = product.vatCode;
      vatRatePercentSnapshot = product.vatCode ? taxRateByCode.get(product.vatCode) ?? null : null;
    }

    const amounts = computeQuotationLineAmounts({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? null,
      vatRatePercent: vatRatePercentSnapshot,
    });

    resolved.push({ input: line, productId, sapItemCodeSnapshot, sapItemDescriptionSnapshot, unitOfMeasure, vatCodeSnapshot, vatRatePercentSnapshot, amounts });
  }

  return { ok: true, lines: resolved };
}

export async function createQuotation(input: CreateQuotationInput, actorId: string): Promise<CreateQuotationResult> {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  if (!customer) {
    return { ok: false, status: 404, message: "Customer not found." };
  }

  if (input.customerContactId) {
    const contact = await prisma.customerContact.findFirst({ where: { id: input.customerContactId, customerId: input.customerId }, select: { id: true } });
    if (!contact) {
      return { ok: false, status: 400, message: "The selected contact does not belong to this customer.", fieldErrors: { customerContactId: "Contact does not belong to this customer." } };
    }
  }

  const salespersonId = input.salespersonId ?? actorId;
  if (salespersonId !== actorId) {
    const salesperson = await prisma.user.findUnique({ where: { id: salespersonId }, select: { id: true } });
    if (!salesperson) {
      return { ok: false, status: 404, message: "Assigned salesperson not found." };
    }
  }

  const windowCheck = validateValidityWindow(input.quotationDate, input.validUntil);
  if (!windowCheck.ok) {
    return { ok: false, status: 400, message: windowCheck.message, fieldErrors: { validUntil: windowCheck.message } };
  }

  const resolvedLines = await resolveQuotationLines(input.lines);
  if (!resolvedLines.ok) {
    return resolvedLines;
  }

  const totals = computeQuotationTotals(resolvedLines.lines.map((l) => l.amounts));
  const quotationDate = dateOnlyStringToUtcDate(input.quotationDate)!;
  const validUntil = dateOnlyStringToUtcDate(input.validUntil)!;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const quotationNumber = generateQuotationNumber();

    try {
      const created = await prisma.$transaction(async (tx) => {
        const quotation = await tx.quotation.create({
          data: {
            quotationNumber,
            revisionNumber: 1,
            customerId: input.customerId,
            customerContactId: input.customerContactId ?? null,
            quotationDate,
            validUntil,
            currency: input.currency ?? "USD",
            customerReference: input.customerReference ?? null,
            preparedById: actorId,
            salespersonId,
            internalNotes: input.internalNotes ?? null,
            customerNotes: input.customerNotes ?? null,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            vatTotal: totals.vatTotal,
            total: totals.total,
            isDemo: false,
            lines: {
              create: resolvedLines.lines.map((line, index) => ({
                lineNumber: index + 1,
                productId: line.productId,
                sapItemCodeSnapshot: line.sapItemCodeSnapshot,
                sapItemDescriptionSnapshot: line.sapItemDescriptionSnapshot,
                isUnlistedItem: line.input.isUnlistedItem ?? false,
                unlistedItemDescription: line.input.isUnlistedItem ? line.input.unlistedItemDescription : null,
                quantity: new Prisma.Decimal(line.input.quantity),
                unitOfMeasure: line.unitOfMeasure,
                unitPrice: new Prisma.Decimal(line.input.unitPrice),
                discountPercent: line.input.discountPercent ? new Prisma.Decimal(line.input.discountPercent) : null,
                vatCodeSnapshot: line.vatCodeSnapshot,
                vatRatePercentSnapshot: line.vatRatePercentSnapshot ? new Prisma.Decimal(line.vatRatePercentSnapshot) : null,
                lineSubtotal: line.amounts.lineSubtotal,
                discountAmount: line.amounts.discountAmount,
                vatAmount: line.amounts.vatAmount,
                lineTotal: line.amounts.lineTotal,
                notes: line.input.notes ?? null,
              })),
            },
          },
          select: { id: true, quotationNumber: true },
        });

        await tx.quotationEvent.create({
          data: { quotationId: quotation.id, eventType: "CREATED", actorId, notes: `Created with ${resolvedLines.lines.length} line(s).` },
        });

        await tx.auditEvent.create({
          data: {
            actorId,
            action: "QUOTATION_CREATED",
            entityType: "Quotation",
            entityId: quotation.id,
            afterData: {
              quotationNumber: quotation.quotationNumber,
              customerId: input.customerId,
              lineCount: resolvedLines.lines.length,
              total: totals.total.toString(),
              // Milestone 12 (Sales Performance Intelligence). Same
              // provenance shape as lib/orders.ts's ORDER_CREATE event,
              // read by lib/reporting/attribution.ts's
              // classifyQuotationSourcedAttribution for any order later
              // converted from this quotation. Unlike the order case,
              // `salespersonId` here is NEVER null (Quotation.salespersonId
              // is a required field -- see that model's own schema
              // comment), so "source: unassigned" means "defaulted to
              // the preparer, not a confirmed deliberate pick" rather
              // than "literally no value" -- app/quotations/new/
              // new-quotation-form.tsx's picker now loads with nothing
              // selected (no more pre-fill-to-self) so this distinction
              // is actually meaningful going forward.
              salespersonAssignment: {
                salespersonId,
                source: input.salespersonId ? "explicit" : "unassigned",
                assignedById: actorId,
              },
            },
          },
        });

        return quotation;
      }, TRANSACTION_OPTIONS);

      return { ok: true, id: created.id, quotationNumber: created.quotationNumber };
    } catch (error) {
      if (isUniqueViolation(error)) {
        continue; // reference collision -- retry with a fresh number
      }
      throw error;
    }
  }

  return { ok: false, status: 500, message: "Could not generate a unique quotation number after several attempts." };
}
