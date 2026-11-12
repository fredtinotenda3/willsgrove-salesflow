/**
 * Milestone 2B. The one action that turns a reviewed PO intake document
 * into a real CustomerOrder -- reuses lib/orders.ts's createOrderCore
 * inside its OWN transaction (never lib/orders.ts's public createOrder(),
 * which owns its own transaction and reference-collision retry loop that
 * can't be nested inside this one), so that order creation, linking the
 * OrderDocument back to the new order, recording which ExtractedOrderLine
 * became which OrderLine, and alias-learning from every human-confirmed
 * match are all one atomic unit -- never a state where the order exists
 * but the document/lines don't know about it, or vice versa.
 *
 * Deliberately does NOT re-run lib/order-validation.ts's createOrderSchema
 * against anything: that schema validates a raw HTTP payload shaped
 * exactly like CreateOrderInput, which this function's input is not (it
 * carries line DECISIONS -- accept/exclude, optional overrides -- not
 * already-final order lines, and needs a source value createOrderSchema
 * deliberately excludes -- see that file's comment). The API route
 * validates the actual HTTP payload with confirm-review-validation.ts's
 * own schema before this function is ever called; everything this
 * function builds from that validated input is constructed directly as
 * a plain, already-correct value, the same trust boundary lib/orders.ts's
 * own createOrder() already uses for its own (differently-shaped) input.
 */
import "server-only";
import type { OrderSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createOrderCore, generateOrderReference, isUniqueViolation, TRANSACTION_OPTIONS, type OrderCreationInput } from "@/lib/orders";
import { extractionHeaderSchema } from "@/lib/extraction/schema";
import { recordProductAlias, recordCustomerAlias } from "@/lib/matching/aliases";
import { buildCustomerSearchText } from "@/lib/matching/customer-matcher";
import { checkForDuplicates, type DuplicateWarning } from "@/lib/review/duplicate-check";
import type { ConfirmReviewInput } from "@/lib/review/confirm-review-validation";

export type ConfirmReviewResult =
  | {
      ok: true;
      // Kept pointing at the PRIMARY group's order (input.customerId's
      // group, or the first group when every line was reassigned away
      // from it -- see confirmReviewSession's grouping logic below) so
      // every existing single-store caller (the Milestone 2B API route,
      // the Milestone 2B integration test) keeps working unchanged: for
      // a document with no per-line customer overrides, `orders` below
      // always has exactly one entry and these two fields are simply its
      // id/reference, exactly as before Milestone 2C.
      orderId: string;
      orderReference: string;
      acceptedLineCount: number;
      excludedLineCount: number;
      // Milestone 2C: multi-store splitting. One entry per CustomerOrder
      // actually created -- always at least one (the primary group).
      // More than one only when the request's line decisions carried
      // per-line `customerId` overrides naming a different store.
      orders: { orderId: string; orderReference: string; customerId: string }[];
    }
  | {
      ok: false;
      status: number;
      message: string;
      fieldErrors?: Record<string, string>;
      duplicateWarnings?: DuplicateWarning[];
    };

const MAX_REFERENCE_ATTEMPTS = 5;

/** header.currencyRaw is free-text from extraction, never format-checked -- only use it when it's actually a plausible 3-letter code; "USD" otherwise, same default createOrderCore already applies for manual entry. */
function sanitizeCurrency(raw: string | null | undefined): string {
  if (!raw) return "USD";
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : "USD";
}

export async function confirmReviewSession(
  documentId: string,
  actorId: string,
  input: ConfirmReviewInput,
  options?: { isDemo?: boolean }
): Promise<ConfirmReviewResult> {
  const document = await prisma.orderDocument.findUnique({
    where: { id: documentId },
    select: { id: true, orderId: true, checksum: true, sourceChannel: true },
  });
  if (!document) {
    return { ok: false, status: 404, message: "Document not found." };
  }
  if (document.orderId) {
    return { ok: false, status: 409, message: "This document has already been confirmed into an order." };
  }
  if (!document.sourceChannel) {
    // Defensive only -- every document created by lib/po-intake.ts
    // (Milestone 2A) always sets sourceChannel; this should never happen.
    return { ok: false, status: 500, message: "This document has no recorded source channel and cannot be confirmed." };
  }

  const extractionRun = await prisma.extractionRun.findFirst({
    where: { documentId, status: "SUCCEEDED" },
    orderBy: { startedAt: "desc" },
    select: { id: true, extractedHeader: true },
  });
  if (!extractionRun) {
    return { ok: false, status: 400, message: "This document has no successful extraction to confirm." };
  }

  const headerParsed = extractionHeaderSchema.safeParse(extractionRun.extractedHeader);
  if (!headerParsed.success) {
    return { ok: false, status: 500, message: "The stored extraction header is invalid or corrupted." };
  }
  const header = headerParsed.data;

  const materializedLines = await prisma.extractedOrderLine.findMany({
    where: { extractionRunId: extractionRun.id },
    orderBy: { lineNumber: "asc" },
  });
  if (materializedLines.length === 0) {
    return { ok: false, status: 400, message: "Open the review workspace for this document before confirming it." };
  }

  // Full-coverage check: every materialized line must have exactly one
  // decision, and the request must not reference a line from a
  // different document/run.
  const materializedIds = new Set(materializedLines.map((line) => line.id));
  const decisionIds = new Set<string>();
  for (const line of input.lines) {
    if (decisionIds.has(line.extractedOrderLineId)) {
      return { ok: false, status: 400, message: `Line ${line.extractedOrderLineId} was decided more than once.` };
    }
    decisionIds.add(line.extractedOrderLineId);
    if (!materializedIds.has(line.extractedOrderLineId)) {
      return { ok: false, status: 400, message: `Line ${line.extractedOrderLineId} does not belong to this document's review session.` };
    }
  }
  const missingDecisions = materializedLines.filter((line) => !decisionIds.has(line.id));
  if (missingDecisions.length > 0) {
    return {
      ok: false,
      status: 400,
      message: `Line${missingDecisions.length > 1 ? "s" : ""} ${missingDecisions.map((line) => line.lineNumber).join(", ")} have no decision (accept or exclude).`,
    };
  }

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  if (!customer) {
    return { ok: false, status: 404, message: "Customer not found.", fieldErrors: { customerId: "Customer not found." } };
  }
  if (input.customerLocationId) {
    const location = await prisma.customerLocation.findFirst({
      where: { id: input.customerLocationId, customerId: input.customerId },
      select: { id: true },
    });
    if (!location) {
      return {
        ok: false,
        status: 400,
        message: "The selected location does not belong to this customer.",
        fieldErrors: { customerLocationId: "Location does not belong to this customer." },
      };
    }
  }

  const decisionById = new Map(input.lines.map((line) => [line.extractedOrderLineId, line]));

  type AcceptedLine = {
    extractedOrderLineId: string;
    originalDescription: string;
    productId: string | null;
    requestedQuantity: string;
    requestedUnitCode: string;
    customerUnitPrice: string | null;
    salesNotes: string | null;
    // Milestone 2C: multi-store splitting. decision.customerId ?? input.customerId
    // -- the document-level default unless this specific line carries its own
    // override. For every document today (no overrides used), this is always
    // input.customerId for every line, i.e. exactly one group.
    customerId: string;
  };
  const acceptedLines: AcceptedLine[] = [];
  const excludedLines: { id: string; notes: string | null }[] = [];
  const missingDataLineNumbers: number[] = [];

  for (const line of materializedLines) {
    const decision = decisionById.get(line.id);
    if (!decision) continue; // unreachable given the coverage check above

    if (decision.decision === "EXCLUDED") {
      excludedLines.push({ id: line.id, notes: decision.salesNotes ?? null });
      continue;
    }

    const resolvedQuantity = decision.requestedQuantity !== undefined ? decision.requestedQuantity : line.extractedQuantity?.toString() ?? null;
    const resolvedUnit = decision.requestedUnitCode !== undefined ? decision.requestedUnitCode : line.extractedUnit;
    const resolvedProductId = decision.productId !== undefined ? decision.productId : line.matchedProductId;

    if (resolvedQuantity === null || resolvedQuantity === "" || !resolvedUnit) {
      missingDataLineNumbers.push(line.lineNumber);
      continue;
    }

    acceptedLines.push({
      extractedOrderLineId: line.id,
      originalDescription: line.originalDescription,
      productId: resolvedProductId,
      requestedQuantity: resolvedQuantity,
      requestedUnitCode: resolvedUnit,
      customerUnitPrice: line.customerProvidedUnitPrice?.toString() ?? null,
      salesNotes: decision.salesNotes ?? null,
      customerId: decision.customerId ?? input.customerId,
    });
  }

  if (missingDataLineNumbers.length > 0) {
    return {
      ok: false,
      status: 400,
      message: `Line${missingDataLineNumbers.length > 1 ? "s" : ""} ${missingDataLineNumbers.join(", ")} need both a quantity and a unit before this order can be confirmed.`,
    };
  }
  if (acceptedLines.length === 0) {
    return { ok: false, status: 400, message: "At least one line must be accepted to confirm this order." };
  }

  // Milestone 2C: multi-store splitting. Group accepted lines by their
  // EFFECTIVE customer. Overwhelmingly a single group equal to
  // input.customerId (today's single-store behavior, completely
  // unchanged); when one or more lines carry a per-line override, each
  // distinct customer becomes its own CustomerOrder, created atomically
  // alongside the others inside the one transaction below. Map insertion
  // order preserves first-seen order so multiple resulting orders read
  // top-to-bottom the same way the original document did.
  const groupedLines = new Map<string, AcceptedLine[]>();
  for (const line of acceptedLines) {
    const group = groupedLines.get(line.customerId);
    if (group) {
      group.push(line);
    } else {
      groupedLines.set(line.customerId, [line]);
    }
  }
  // The "primary" group is the one OrderDocument.orderId keeps pointing
  // at, and whose id/reference stay the top-level orderId/orderReference
  // fields for backward compatibility with every existing single-store
  // caller: input.customerId's group when it has any lines, otherwise
  // the first group encountered (the edge case where every single line
  // was reassigned away from the document's own default customer).
  const primaryCustomerId = groupedLines.has(input.customerId) ? input.customerId : [...groupedLines.keys()][0]!;
  const groupCustomerIds = [primaryCustomerId, ...[...groupedLines.keys()].filter((id) => id !== primaryCustomerId)];

  // input.customerId was already validated to exist above; validate every
  // OTHER distinct customer referenced by a per-line override too, so a
  // bad id fails clearly here rather than surfacing later as a foreign-key
  // violation deep inside the transaction.
  const otherGroupCustomerIds = groupCustomerIds.filter((id) => id !== input.customerId);
  if (otherGroupCustomerIds.length > 0) {
    const foundOtherCustomers = await prisma.customer.findMany({
      where: { id: { in: otherGroupCustomerIds } },
      select: { id: true },
    });
    const foundOtherIds = new Set(foundOtherCustomers.map((c) => c.id));
    const missingOtherCustomers = otherGroupCustomerIds.filter((id) => !foundOtherIds.has(id));
    if (missingOtherCustomers.length > 0) {
      return {
        ok: false,
        status: 400,
        message: `One or more line-level customer overrides do not exist: ${missingOtherCustomers.join(", ")}`,
      };
    }
  }

  const referencedProductIds = [...new Set(acceptedLines.map((line) => line.productId).filter((id): id is string => Boolean(id)))];
  const productSapCodeById = new Map<string, string>();
  if (referencedProductIds.length > 0) {
    const foundProducts = await prisma.product.findMany({
      where: { id: { in: referencedProductIds } },
      select: { id: true, sapItemCode: true },
    });
    const foundIds = new Set(foundProducts.map((p) => p.id));
    const missing = referencedProductIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return { ok: false, status: 400, message: `One or more referenced products do not exist: ${missing.join(", ")}` };
    }
    for (const product of foundProducts) productSapCodeById.set(product.id, product.sapItemCode);
  }

  const resolvedCustomerPoReference = input.header?.customerPoReference !== undefined ? input.header.customerPoReference : header.customerPoNumber;

  // Milestone 2C: run the duplicate check once per distinct group
  // customer -- SAME_CUSTOMER_PO_REFERENCE is customer-scoped, so a split
  // document must check it against EVERY customer it will create an
  // order for, not just the primary one. SAME_DOCUMENT_CHECKSUM is
  // document-scoped (identical every time), so it's deduplicated down to
  // at most one warning rather than repeated once per group. All-or-
  // nothing: the whole confirm is rejected (409) if ANY group has an
  // unacknowledged warning, never a partial per-group apply.
  const duplicateWarnings: DuplicateWarning[] = [];
  let checksumWarningAdded = false;
  for (const groupCustomerId of groupCustomerIds) {
    const groupWarnings = await checkForDuplicates({
      documentId: document.id,
      documentChecksum: document.checksum,
      customerId: groupCustomerId,
      customerPoReference: resolvedCustomerPoReference,
    });
    for (const warning of groupWarnings) {
      if (warning.kind === "SAME_DOCUMENT_CHECKSUM") {
        if (checksumWarningAdded) continue;
        checksumWarningAdded = true;
      }
      duplicateWarnings.push(warning);
    }
  }
  if (duplicateWarnings.length > 0 && !input.acknowledgeDuplicate) {
    return {
      ok: false,
      status: 409,
      message: "This looks like it may be a duplicate of an existing order. Acknowledge the warning to confirm anyway.",
      duplicateWarnings,
    };
  }

  const resolvedOrderDate = input.header?.orderDate !== undefined ? input.header.orderDate : header.poDate;
  const resolvedRequestedDeliveryDate =
    input.header?.requestedDeliveryDate !== undefined ? input.header.requestedDeliveryDate : header.requestedDeliveryDate;
  const resolvedDeliveryAddress = input.header?.deliveryAddress !== undefined ? input.header.deliveryAddress : header.deliveryAddressRaw;
  const resolvedCurrency = input.header?.currency ?? sanitizeCurrency(header.currencyRaw);
  const resolvedInternalNotes = input.header?.internalNotes ?? null;

  const isDemo = options?.isDemo ?? false;
  const source: OrderSource = document.sourceChannel;

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    // Milestone 2C: a fresh reference per GROUP, regenerated for every
    // group on every attempt -- if any one order's reference collides,
    // the whole attempt is retried with an entirely new set, never just
    // the one that collided, so there's no risk of two orders in the
    // same attempt ending up with the same reference.
    const referenceByCustomerId = new Map<string, string>();
    for (const groupCustomerId of groupCustomerIds) {
      referenceByCustomerId.set(groupCustomerId, generateOrderReference());
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const createdOrders: { orderId: string; orderReference: string; customerId: string }[] = [];
        let primaryOrderId: string | undefined;
        let primaryOrderReference: string | undefined;

        // All orders created from one document share the same ONE
        // transaction -- either every group's order is created, or (on
        // any error, including a reference collision on just one of
        // them) none are, never a partial split.
        for (const groupCustomerId of groupCustomerIds) {
          const groupLines = groupedLines.get(groupCustomerId)!;
          const reference = referenceByCustomerId.get(groupCustomerId)!;

          const orderCreationInput: OrderCreationInput = {
            customerId: groupCustomerId,
            // customerLocationId only ever applies to the PRIMARY
            // group -- a per-line customer override has no corresponding
            // location input on this request shape, so every other
            // group's order is created with no location.
            customerLocationId: groupCustomerId === primaryCustomerId ? input.customerLocationId ?? null : null,
            customerPoReference: resolvedCustomerPoReference ?? null,
            // Milestone 12 (Sales Performance Intelligence). Applied to
            // EVERY group's order uniformly -- same "one default for the
            // whole document" convention as every other header field
            // above. Omitted/null preserved as NULL (createOrderCore no
            // longer defaults this to createdById); never derived from
            // actorId or from any per-line decision.
            salespersonId: input.salespersonId ?? null,
            source,
            orderDate: resolvedOrderDate ?? null,
            requestedDeliveryDate: resolvedRequestedDeliveryDate ?? null,
            deliveryAddress: resolvedDeliveryAddress ?? null,
            currency: resolvedCurrency,
            // The intake document already carries the original pasted
            // text/file, independently retrievable via its own detail view
            // -- not duplicated onto the order itself. See this file's
            // module comment and docs/milestones/PROGRESS.md.
            originalSourceText: null,
            internalNotes: resolvedInternalNotes,
            idempotencyKey: undefined,
            lines: groupLines.map((line) => ({
              originalProductDescription: line.originalDescription,
              productId: line.productId,
              sapItemCodeSnapshot: line.productId ? productSapCodeById.get(line.productId) ?? null : null,
              requestedQuantity: line.requestedQuantity,
              requestedUnitCode: line.requestedUnitCode,
              customerUnitPrice: line.customerUnitPrice,
              salesNotes: line.salesNotes,
            })),
          };

          const order = await createOrderCore(tx, reference, orderCreationInput, actorId, isDemo);
          const orderLineIdByNumber = new Map(order.lines.map((line) => [line.lineNumber, line.id]));

          for (let index = 0; index < groupLines.length; index++) {
            const accepted = groupLines[index]!;
            const orderLineId = orderLineIdByNumber.get(index + 1);
            if (!orderLineId) {
              throw new Error("Internal error: the created order is missing an expected line.");
            }

            await tx.extractedOrderLine.update({
              where: { id: accepted.extractedOrderLineId },
              data: { status: "ACCEPTED", resultingOrderLineId: orderLineId, reviewedById: actorId, reviewedAt: new Date() },
            });

            if (accepted.productId) {
              // Recorded against THIS line's own effective customer
              // (groupCustomerId), not the document-level default -- a
              // per-line override means a different store calls this
              // product by this text, which is exactly what should
              // strengthen that store's own alias, not the default
              // customer's.
              await recordProductAlias(tx, {
                rawText: accepted.originalDescription,
                productId: accepted.productId,
                customerId: groupCustomerId,
                createdById: actorId,
                isDemo,
              });
            }
          }

          createdOrders.push({ orderId: order.id, orderReference: reference, customerId: groupCustomerId });
          if (groupCustomerId === primaryCustomerId) {
            primaryOrderId = order.id;
            primaryOrderReference = reference;
          }
        }

        for (const excluded of excludedLines) {
          await tx.extractedOrderLine.update({
            where: { id: excluded.id },
            data: { status: "EXCLUDED", reviewedById: actorId, reviewedAt: new Date(), reviewNotes: excluded.notes },
          });
        }

        // Alias learning for the HEADER text is tied to the document's
        // own default customer (input.customerId), never per split group:
        // a per-line override is a one-off correction for that one line,
        // not evidence that the document's header text itself means that
        // other customer.
        const headerAliasText = buildCustomerSearchText(header.customerNameRaw, header.storeOrBranchRaw);
        if (headerAliasText !== "") {
          await recordCustomerAlias(tx, { rawText: headerAliasText, customerId: input.customerId, createdById: actorId, isDemo });
        }
        const extraAliasText = input.customerAliasText?.trim() ?? "";
        if (extraAliasText !== "" && extraAliasText.toLowerCase() !== headerAliasText.toLowerCase()) {
          await recordCustomerAlias(tx, { rawText: extraAliasText, customerId: input.customerId, createdById: actorId, isDemo });
        }

        if (!primaryOrderId || !primaryOrderReference) {
          // Unreachable: primaryCustomerId is always one of groupCustomerIds,
          // so the loop above always sets these on its way through.
          throw new Error("Internal error: no primary order was created.");
        }

        // OrderDocument.orderId keeps its Milestone 2B meaning exactly --
        // a single nullable FK to the PRIMARY order only. Every order a
        // split document produced is still fully derivable later via
        // ExtractedOrderLine.resultingOrderLineId -> OrderLine.orderId,
        // with no schema change needed for that linkage.
        await tx.orderDocument.update({
          where: { id: documentId },
          data: { orderId: primaryOrderId, status: "CONFIRMED" },
        });

        await tx.auditEvent.create({
          data: {
            actorId,
            action: "PO_REVIEW_CONFIRMED",
            entityType: "OrderDocument",
            entityId: documentId,
            afterData: {
              orderId: primaryOrderId,
              orderReference: primaryOrderReference,
              extractionRunId: extractionRun.id,
              acceptedLineCount: acceptedLines.length,
              excludedLineCount: excludedLines.length,
              orders: createdOrders,
            },
          },
        });

        return { orderId: primaryOrderId, orderReference: primaryOrderReference, orders: createdOrders };
      }, TRANSACTION_OPTIONS);

      return { ok: true, ...result, acceptedLineCount: acceptedLines.length, excludedLineCount: excludedLines.length };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Reference collision (astronomically unlikely) -- retry the
        // WHOLE attempt with a fresh set of references for every group,
        // same as lib/orders.ts's createOrder.
        continue;
      }
      throw error;
    }
  }

  return { ok: false, status: 500, message: "Could not generate a unique order reference. Please try again." };
}
