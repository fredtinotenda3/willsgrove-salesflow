import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { multiplyDecimalStrings } from "@/lib/lost-sales/validation";
import { validateNativeInvoiceLineQuantity, type RecordNativeInvoiceInput } from "@/lib/invoice-recording/validation";

/**
 * Real-world fix (native invoice recording). See validation.ts's own
 * comment for the full problem this closes.
 *
 * Deliberately NO schema migration. A native invoice is stored as an
 * entirely ordinary SapInvoice + SapInvoiceLine(s), through the exact
 * same tables a real SAP import writes to -- so every downstream
 * consumer (Delivered Orders list/detail, recordInvoiceDeliveryOutcome,
 * Invoice Claims' SAP-anchored path) keeps working completely unchanged,
 * with zero special-casing. The one new table row this needs regardless
 * (SapInvoiceImportBatch) already exists purely to answer "who did this
 * and when, from what" for a real import -- recording one invoice
 * directly in SalesFlow is structurally the same fact ("this user, at
 * this time, caused this SapInvoice to exist"), so it gets a batch row
 * too, honestly labelled as not an import at all. Provenance is never
 * left ambiguous: rawSourceData on both the invoice and its lines always
 * carries `{ source: "NATIVE_RECORDING" }`, the one signal
 * isNativelyRecordedInvoice() (lib/invoice-recording/queries.ts) checks
 * -- never inferred from sapDocEntry being null or from sapDocNum's
 * prefix, both of which a real SAP export could coincidentally produce.
 *
 * Why not add a schema column instead (e.g. SapInvoice.origin)? This
 * sandbox has no live database to generate or test a migration against
 * (confirmed: the Prisma client here is fully stubbed), so a hand-written
 * migration SQL file could not be verified and would be a real risk
 * against production invoicing data. This approach needs none -- every
 * field it writes already exists, already nullable/JSON exactly where
 * needed, and is used here strictly within its already-documented
 * meaning (see the inline comments below on subtotal/taxTotal/
 * reconciliationStatus etc.).
 */

export type RecordNativeInvoiceResult =
  | { ok: true; id: string; sapDocNum: string }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

/**
 * Same `PREFIX-YYYYMMDD-8HEXRANDOM` shape as generateClaimReference()/
 * generateOrderReference() -- deliberately prefixed `SF-INV-` (SalesFlow
 * Invoice) rather than anything that could be mistaken for a real SAP
 * DocNum, purely for human readability; isNativelyRecordedInvoice() is
 * still the only thing any CODE ever checks.
 */
function generateNativeInvoiceReference(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `SF-INV-${datePart}-${randomPart}`;
}

/**
 * tx-scoped, race-safe re-computation of "what's still outstanding to
 * invoice on this line" -- deliberately NOT a call out to
 * getInvoiceRecordingEligibility() (lib/invoice-recording/queries.ts),
 * which reads through the top-level `prisma` client for the UI's
 * pre-submission display only. The real enforcement has to run against
 * the SAME `tx` that performs the insert below, exactly the precedent
 * lib/invoice-claims/create-claim.ts's own comment documents for its
 * already-claimed check: that is what actually closes the race between
 * two concurrent invoice recordings against the same line, not merely
 * checking twice.
 */
async function getRemainingToInvoice(tx: PrismaTransactionClient, orderLineId: string): Promise<Prisma.Decimal> {
  // Invoicing precedes dispatch, so the ceiling is the quantity PICKED and authorised for the line.
  const [picked, invoiced] = await Promise.all([
    tx.pickingLine.aggregate({
      where: { orderLineId, foundQuantity: { not: null }, pickingSession: { status: "AUTHORIZED" } },
      _sum: { foundQuantity: true },
    }),
    tx.sapInvoiceLine.aggregate({
      where: { matchedOrderLineId: orderLineId, sapInvoice: { isCancelledOrReversed: false } },
      _sum: { quantityInvoiced: true },
    }),
  ]);
  const pickedQuantity = picked._sum.foundQuantity ?? new Prisma.Decimal(0);
  const invoicedQuantity = invoiced._sum.quantityInvoiced ?? new Prisma.Decimal(0);
  return pickedQuantity.minus(invoicedQuantity);
}

export async function recordNativeInvoice(
  orderId: string,
  actorId: string,
  input: RecordNativeInvoiceInput
): Promise<RecordNativeInvoiceResult> {
  const invoiceDate = dateOnlyStringToUtcDate(input.invoiceDate);
  if (!invoiceDate) {
    return { ok: false, status: 400, message: "Invalid invoice date.", fieldErrors: { invoiceDate: "Invalid date." } };
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      reference: true,
      currency: true,
      customerId: true,
      isDemo: true,
      status: true,
      customer: { select: { name: true, sapCustomerCode: true } },
    },
  });
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }
  if (order.status !== "READY_TO_INVOICE") {
    return { ok: false, status: 409, message: "An order can only be marked as Invoiced once picking is completed and authorised (status Ready to Invoice)." };
  }

  const orderLineIds = input.lines.map((line) => line.orderLineId);
  const uniqueLineIds = new Set(orderLineIds);
  if (uniqueLineIds.size !== orderLineIds.length) {
    return { ok: false, status: 400, message: "Each order line may only appear once per invoice.", fieldErrors: { lines: "Duplicate order line." } };
  }

  const orderLines = await prisma.orderLine.findMany({
    where: { id: { in: orderLineIds }, orderId },
    select: {
      id: true,
      originalProductDescription: true,
      sapItemCodeSnapshot: true,
      requestedUnitCode: true,
      product: { select: { sapItemCode: true } },
    },
  });
  if (orderLines.length !== uniqueLineIds.size) {
    return { ok: false, status: 400, message: "One or more lines do not belong to this order.", fieldErrors: { lines: "Invalid order line reference." } };
  }
  const orderLineById = new Map(orderLines.map((line) => [line.id, line]));

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialise concurrent recordings against the SAME order. Under
      // PostgreSQL's default READ COMMITTED isolation, two simultaneous
      // requests could both read "remaining = N" below and both insert,
      // over-invoicing the line (a double-click or a retried request is
      // enough). Taking a row lock on the order first makes the second
      // request wait until the first commits, after which its own
      // remaining-quantity read sees the first invoice and is rejected by
      // validateNativeInvoiceLineQuantity. Different orders never block
      // each other.
      await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${orderId} FOR UPDATE`;

      const lineTotals: { lineTotal: string }[] = [];

      for (const [index, lineInput] of input.lines.entries()) {
        const orderLine = orderLineById.get(lineInput.orderLineId);
        if (!orderLine) continue; // already reported above via the count mismatch

        const remaining = await getRemainingToInvoice(tx, lineInput.orderLineId);
        const quantityCheck = validateNativeInvoiceLineQuantity(remaining.toString(), lineInput.quantityInvoiced);
        if (!quantityCheck.ok) {
          throw new NativeInvoiceValidationError(index, quantityCheck.message);
        }

        const lineTotal = multiplyDecimalStrings(lineInput.unitPrice, lineInput.quantityInvoiced);
        if (lineTotal === null) {
          throw new NativeInvoiceValidationError(index, "Invalid unit price or quantity.");
        }
        lineTotals.push({ lineTotal });
      }

      // Subtotal is the sum of this invoice's own line totals -- an
      // actual computed value from what's being recorded, same as any
      // other money total in this codebase; never a guess. taxTotal is
      // left null (never fabricated): confirmed by reading OrderLine's
      // own schema, there is no tax/VAT resolution on a real customer
      // order at all (see app/orders/[id]/page.tsx's own "Excludes tax"
      // notice) -- total therefore equals subtotal, not subtotal plus an
      // invented tax figure.
      const subtotal = lineTotals.reduce((sum, l) => sum.plus(new Prisma.Decimal(l.lineTotal)), new Prisma.Decimal(0));

      const batch = await tx.sapInvoiceImportBatch.create({
        data: {
          // Honestly labelled as not a file -- see this module's own
          // top comment on why this table is reused rather than adding
          // a schema column.
          originalFileName: `(recorded in SalesFlow -- no import file; order ${order.reference})`,
          uploadedById: actorId,
          columnMapping: {},
          totalRows: 1,
          importedInvoiceCount: 1,
          importedLineCount: input.lines.length,
          duplicateRowCount: 0,
          invalidRowCount: 0,
          isDemo: order.isDemo,
        },
        select: { id: true },
      });

      const sapDocNum = generateNativeInvoiceReference();
      const recordedAt = new Date();

      const invoice = await tx.sapInvoice.create({
        data: {
          importBatchId: batch.id,
          sapDocEntry: null,
          sapDocNum,
          customerSapCode: order.customer.sapCustomerCode,
          customerName: order.customer.name,
          matchedCustomerId: order.customerId,
          invoiceDate,
          currencyCode: order.currency,
          documentStatusRaw: null,
          isCancelledOrReversed: false,
          sapOrderReference: order.reference,
          matchedOrderId: order.id,
          subtotal,
          taxTotal: null,
          total: subtotal,
          // Every line below is created already MANUALLY_MATCHED to its
          // own order line by construction (that's the whole point of
          // this flow) -- "every line resolved, nothing flagged for
          // investigation" is exactly what MATCHED means on this enum.
          reconciliationStatus: "MATCHED",
          reconciliationNotes: null,
          rawSourceData: {
            source: "NATIVE_RECORDING",
            recordedById: actorId,
            recordedAt: recordedAt.toISOString(),
            note: `Recorded directly in SalesFlow against order ${order.reference}; not imported from a SAP export.`,
          },
          isDemo: order.isDemo,
        },
        select: { id: true },
      });

      for (const [index, lineInput] of input.lines.entries()) {
        const orderLine = orderLineById.get(lineInput.orderLineId);
        if (!orderLine) continue;
        const lineTotal = lineTotals[index].lineTotal;

        await tx.sapInvoiceLine.create({
          data: {
            sapInvoiceId: invoice.id,
            lineNumber: index + 1,
            sapItemCode: orderLine.product?.sapItemCode ?? orderLine.sapItemCodeSnapshot,
            sapItemDescription: orderLine.originalProductDescription,
            quantityInvoiced: lineInput.quantityInvoiced,
            unitOfMeasure: orderLine.requestedUnitCode,
            unitPrice: lineInput.unitPrice,
            discount: null,
            taxCode: null,
            lineTotal,
            sapDocLineNum: null,
            rawSourceData: { source: "NATIVE_RECORDING" },
            matchedOrderId: order.id,
            matchedOrderLineId: orderLine.id,
            matchStatus: "MANUALLY_MATCHED",
            matchMethod: "MANUAL",
            matchNote: "Recorded directly against this order's own line; not from a SAP invoice import.",
            matchedById: actorId,
            matchedAt: recordedAt,
            isDemo: order.isDemo,
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "INVOICE_RECORDED_NATIVE",
          entityType: "SapInvoice",
          entityId: invoice.id,
          afterData: {
            sapDocNum,
            orderId: order.id,
            orderReference: order.reference,
            lineCount: input.lines.length,
            total: subtotal.toString(),
            currencyCode: order.currency,
          },
        },
      });

      return { id: invoice.id, sapDocNum };
    }, TRANSACTION_OPTIONS);

    return { ok: true, id: result.id, sapDocNum: result.sapDocNum };
  } catch (error) {
    if (error instanceof NativeInvoiceValidationError) {
      return {
        ok: false,
        status: 400,
        message: `Line ${error.index + 1}: ${error.validationMessage}`,
        fieldErrors: { [`lines.${error.index}`]: error.validationMessage },
      };
    }
    throw error;
  }
}

class NativeInvoiceValidationError extends Error {
  constructor(public readonly index: number, public readonly validationMessage: string) {
    super(validationMessage);
  }
}
