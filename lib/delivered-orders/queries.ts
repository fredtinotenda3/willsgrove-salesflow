import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CLAIM_LINE_REASON_CATEGORY_LABELS, type AnyStoredClaimLineReasonCategory } from "@/lib/invoice-claims/validation";
import { isNativelyRecordedInvoice } from "@/lib/invoice-recording/queries";

/**
 * Management Analytics spec, Part 6: "Complete Delivered Orders
 * history." "Delivered" is defined exactly as lib/invoice-delivery/
 * queries.ts's own derived status already defines it for the
 * /invoice-reconciliation list (Part 3/the earlier Final Operational
 * Enhancements round): an SapInvoice that has an InvoiceDeliveryRecord.
 * This module does not invent a second definition of "delivered" --
 * listDeliveredOrders below starts from InvoiceDeliveryRecord, the
 * same single source of truth, so the two pages can never disagree
 * about which invoices are delivered.
 *
 * Every field surfaced here is read from an EXISTING model -- no new
 * table, no new column. Where a step of the lifecycle has no
 * corresponding timestamp on a given order (e.g. no dispatch was ever
 * recorded, or picking was never authorized), getDeliveredOrderDetail
 * returns null for that stage/duration rather than guessing -- spec
 * Part 6(H), verbatim: "where timestamps are missing, display 'Not
 * Available' rather than assuming zero." The UI layer is responsible
 * for rendering null as "Not Available"; this module itself returns
 * typed nulls, never a 0 or an invented date.
 */

export type DeliveredOrderRow = {
  invoiceDeliveryRecordId: string;
  sapInvoiceId: string;
  sapDocNum: string;
  customerId: string | null;
  customerName: string | null;
  orderId: string | null;
  orderReference: string | null;
  customerPoReference: string | null;
  salespersonName: string | null;
  outcome: string;
  hasClaim: boolean;
  recordedAt: string;
  recordedByName: string;
  driverNames: string[];
  vehicleRegistrations: string[];
  totalInvoiced: string | null;
  currencyCode: string | null;
  // Real-world fix (native invoice recording): true when this invoice was
  // recorded directly in SalesFlow (lib/invoice-recording/
  // record-native-invoice.ts) rather than imported from a SAP export --
  // see isNativelyRecordedInvoice's own comment for why this is the one
  // place that distinction is decided.
  isNativelyRecorded: boolean;
};

export type DeliveredOrdersFilters = {
  customerId?: string;
  invoiceSearch?: string; // SAP doc number, contains, case-insensitive
  poReference?: string; // matches CustomerOrder.reference or customerPoReference, contains, case-insensitive
  productSearch?: string; // SapInvoiceLine.sapItemCode or sapItemDescription, contains, case-insensitive
  salespersonId?: string;
  driverId?: string;
  vehicleId?: string;
  dateFrom?: string | null; // InvoiceDeliveryRecord.recordedAt, inclusive UTC calendar day
  dateTo?: string | null;
  outcome?: "NO_CLAIM" | "WITH_CLAIM";
  rejectionReasonCategory?: string; // InvoiceClaimLine.reasonCategory
  includeDemo: boolean;
};

export type PaginatedDeliveredOrders = {
  rows: DeliveredOrderRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

function dateOnlyRange(dateFrom?: string | null, dateTo?: string | null): Prisma.DateTimeFilter | undefined {
  if (!dateFrom && !dateTo) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (dateFrom) filter.gte = new Date(`${dateFrom}T00:00:00.000Z`);
  if (dateTo) filter.lt = new Date(new Date(`${dateTo}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  return filter;
}

export async function listDeliveredOrders(filters: DeliveredOrdersFilters, pagination: { page: number; pageSize: number }): Promise<PaginatedDeliveredOrders> {
  const recordedAt = dateOnlyRange(filters.dateFrom, filters.dateTo);

  const sapInvoiceFilter: Prisma.SapInvoiceWhereInput = {
    ...(filters.includeDemo ? {} : { isDemo: false }),
    ...(filters.customerId ? { matchedCustomerId: filters.customerId } : {}),
    ...(filters.invoiceSearch ? { sapDocNum: { contains: filters.invoiceSearch, mode: "insensitive" } } : {}),
    ...(filters.productSearch
      ? { lines: { some: { OR: [{ sapItemCode: { contains: filters.productSearch, mode: "insensitive" } }, { sapItemDescription: { contains: filters.productSearch, mode: "insensitive" } }] } } }
      : {}),
    ...(filters.poReference || filters.salespersonId || filters.driverId || filters.vehicleId
      ? {
          matchedOrder: {
            ...(filters.poReference ? { OR: [{ reference: { contains: filters.poReference, mode: "insensitive" } }, { customerPoReference: { contains: filters.poReference, mode: "insensitive" } }] } : {}),
            ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
            ...(filters.driverId || filters.vehicleId
              ? {
                  dispatchRecords: {
                    some: {
                      ...(filters.driverId ? { driverId: filters.driverId } : {}),
                      ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
                    },
                  },
                }
              : {}),
          },
        }
      : {}),
  };

  const where: Prisma.InvoiceDeliveryRecordWhereInput = {
    ...(filters.includeDemo ? {} : { isDemo: false }),
    ...(recordedAt ? { recordedAt } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.rejectionReasonCategory ? { claims: { some: { lines: { some: { reasonCategory: filters.rejectionReasonCategory as AnyStoredClaimLineReasonCategory } } } } } : {}),
    sapInvoice: sapInvoiceFilter,
  };

  const [totalItems, records] = await Promise.all([
    prisma.invoiceDeliveryRecord.count({ where }),
    prisma.invoiceDeliveryRecord.findMany({
      where,
      orderBy: { recordedAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        sapInvoiceId: true,
        outcome: true,
        recordedAt: true,
        recordedBy: { select: { name: true } },
        claims: { select: { id: true } },
        sapInvoice: {
          select: {
            id: true,
            sapDocNum: true,
            total: true,
            currencyCode: true,
            matchedCustomerId: true,
            matchedCustomer: { select: { name: true } },
            customerName: true,
            rawSourceData: true,
            matchedOrder: {
              select: {
                id: true,
                reference: true,
                customerPoReference: true,
                salesperson: { select: { name: true } },
                dispatchRecords: {
                  where: { status: { not: "CANCELLED" } },
                  select: { driver: { select: { name: true } }, vehicle: { select: { registrationNumber: true } } },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const rows: DeliveredOrderRow[] = records.map((record) => {
    const driverNames = [...new Set((record.sapInvoice.matchedOrder?.dispatchRecords ?? []).map((d) => d.driver?.name).filter((n): n is string => Boolean(n)))];
    const vehicleRegistrations = [...new Set((record.sapInvoice.matchedOrder?.dispatchRecords ?? []).map((d) => d.vehicle?.registrationNumber).filter((n): n is string => Boolean(n)))];
    return {
      invoiceDeliveryRecordId: record.id,
      sapInvoiceId: record.sapInvoiceId,
      sapDocNum: record.sapInvoice.sapDocNum,
      customerId: record.sapInvoice.matchedCustomerId,
      customerName: record.sapInvoice.matchedCustomer?.name ?? record.sapInvoice.customerName,
      orderId: record.sapInvoice.matchedOrder?.id ?? null,
      orderReference: record.sapInvoice.matchedOrder?.reference ?? null,
      customerPoReference: record.sapInvoice.matchedOrder?.customerPoReference ?? null,
      salespersonName: record.sapInvoice.matchedOrder?.salesperson?.name ?? null,
      outcome: record.outcome,
      hasClaim: record.claims.length > 0,
      recordedAt: record.recordedAt.toISOString(),
      recordedByName: record.recordedBy.name,
      driverNames,
      vehicleRegistrations,
      totalInvoiced: record.sapInvoice.total?.toString() ?? null,
      currencyCode: record.sapInvoice.currencyCode,
      isNativelyRecorded: isNativelyRecordedInvoice(record.sapInvoice.rawSourceData),
    };
  });

  return { rows, pagination: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) } };
}

// ---------------------------------------------------------------------------
// Full lifecycle detail (spec Part 6, sections A-H)
// ---------------------------------------------------------------------------

export type DurationResult = { label: string; fromLabel: string; toLabel: string; milliseconds: number | null };

/** Diff two possibly-null timestamps -- null ("Not Available") whenever either end is missing, never a fabricated zero. */
function duration(label: string, fromLabel: string, from: Date | null | undefined, toLabel: string, to: Date | null | undefined): DurationResult {
  if (!from || !to) return { label, fromLabel, toLabel, milliseconds: null };
  return { label, fromLabel, toLabel, milliseconds: to.getTime() - from.getTime() };
}

export type DeliveredOrderDetail = {
  sapInvoiceId: string;
  // (A) Original PO
  purchaseOrder: {
    customerId: string | null;
    customerName: string | null;
    customerSapCode: string | null;
    orderId: string | null;
    orderReference: string | null;
    customerPoReference: string | null;
    orderDate: string | null;
    receivedAt: string | null;
    salespersonName: string | null;
    originalSourceText: string | null;
    currency: string | null;
    lines: { lineNumber: number; sapItemCode: string | null; description: string; requestedQuantity: string; unitPrice: string | null; lineTotal: string | null }[];
  } | null;
  // (B) Picking / fulfilment
  pickingSessions: {
    id: string;
    status: string;
    startedByName: string;
    startedAt: string;
    completedByName: string | null;
    completedAt: string | null;
    authorizedByName: string | null;
    authorizedAt: string | null;
    lines: { description: string; sapItemCode: string | null; requestedQuantity: string; foundQuantity: string | null; unavailableQuantity: string | null; pickedByName: string | null; pickedAt: string | null }[];
  }[];
  // (C) Invoice
  invoice: {
    sapDocNum: string;
    invoiceDate: string | null;
    currencyCode: string | null;
    total: string | null;
    reconciliationStatus: string;
    isCancelledOrReversed: boolean;
    // Real-world fix (native invoice recording): see DeliveredOrderRow's
    // own comment above.
    isNativelyRecorded: boolean;
    lines: { lineNumber: number; sapItemCode: string | null; description: string | null; quantityInvoiced: string; unitPrice: string | null; lineTotal: string | null }[];
  };
  // (D) Dispatch
  dispatches: {
    id: string;
    status: string;
    driverName: string | null;
    assistantName: string | null;
    vehicleRegistration: string | null;
    vehicleOrCourierReference: string | null;
    plannedDepartureAt: string | null;
    departedAt: string | null;
    departedByName: string | null;
    createdByName: string;
    lines: { description: string; sapItemCode: string | null; invoicedQuantity: string | null; dispatchedQuantity: string }[];
    physicalDelivery: {
      outcome: string;
      recordedByName: string;
      recordedAt: string;
      recipientName: string | null;
      lines: { description: string; acceptedQuantity: string; rejectedQuantity: string; rejectionReason: string | null }[];
    } | null;
  }[];
  // (E) Delivery outcome (SalesFlow invoice-level, separate from SAP's own accounting status)
  deliveryOutcome: {
    id: string;
    outcome: string;
    podReference: string | null;
    notes: string | null;
    recordedByName: string;
    recordedAt: string;
  };
  // (F) Claims
  claims: {
    id: string;
    claimReference: string;
    status: string;
    category: string;
    description: string;
    reportedByName: string;
    createdAt: string;
    lines: {
      sapItemCode: string | null;
      description: string | null;
      reasonCategory: string | null;
      reasonLabel: string | null;
      disputeType: string;
      acceptedQuantity: string | null;
      rejectedQuantity: string | null;
      disputedAmount: string | null;
      disputedUnitPrice: string | null;
      reason: string;
    }[];
    attachmentCount: number;
  }[];
  // (G) People/accountability -- every distinct named person touching this order, by role.
  people: { role: string; name: string }[];
  // (H) Durations -- "Not Available" (null) wherever a needed timestamp is missing.
  durations: DurationResult[];
};

export async function getDeliveredOrderDetail(sapInvoiceId: string): Promise<DeliveredOrderDetail | null> {
  const deliveryRecord = await prisma.invoiceDeliveryRecord.findUnique({
    where: { sapInvoiceId },
    select: {
      id: true,
      outcome: true,
      podReference: true,
      notes: true,
      recordedAt: true,
      recordedBy: { select: { name: true } },
      claims: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          claimReference: true,
          status: true,
          category: true,
          description: true,
          createdAt: true,
          reportedBy: { select: { name: true } },
          attachments: { select: { id: true } },
          lines: {
            select: {
              sapItemCodeSnapshot: true,
              sapItemDescriptionSnapshot: true,
              reasonCategory: true,
              disputeType: true,
              acceptedQuantity: true,
              rejectedQuantity: true,
              disputedAmount: true,
              disputedUnitPrice: true,
              reason: true,
            },
          },
        },
      },
    },
  });
  // Not a "delivered order" at all if no outcome has been recorded -- the
  // caller is expected to route here only from the Delivered Orders list,
  // which already filters on this same condition.
  if (!deliveryRecord) return null;

  const sapInvoice = await prisma.sapInvoice.findUnique({
    where: { id: sapInvoiceId },
    select: {
      id: true,
      sapDocNum: true,
      invoiceDate: true,
      currencyCode: true,
      total: true,
      reconciliationStatus: true,
      isCancelledOrReversed: true,
      rawSourceData: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        select: { lineNumber: true, sapItemCode: true, sapItemDescription: true, quantityInvoiced: true, unitPrice: true, lineTotal: true },
      },
      matchedOrder: {
        select: {
          id: true,
          reference: true,
          customerPoReference: true,
          orderDate: true,
          receivedAt: true,
          createdAt: true,
          currency: true,
          originalSourceText: true,
          customer: { select: { id: true, name: true, sapCustomerCode: true } },
          salesperson: { select: { name: true } },
          lines: {
            orderBy: { lineNumber: "asc" },
            select: { lineNumber: true, sapItemCodeSnapshot: true, originalProductDescription: true, requestedQuantity: true, customerUnitPrice: true, approvedUnitPrice: true, lineTotal: true },
          },
          pickingSessions: {
            orderBy: { startedAt: "asc" },
            select: {
              id: true,
              status: true,
              startedAt: true,
              startedBy: { select: { name: true } },
              completedAt: true,
              completedBy: { select: { name: true } },
              authorizedAt: true,
              authorizedBy: { select: { name: true } },
              lines: {
                select: {
                  requestedQuantity: true,
                  foundQuantity: true,
                  unavailableQuantity: true,
                  pickedAt: true,
                  pickedBy: { select: { name: true } },
                  orderLine: { select: { originalProductDescription: true, sapItemCodeSnapshot: true } },
                },
              },
            },
          },
          dispatchRecords: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              status: true,
              plannedDepartureAt: true,
              departedAt: true,
              departedBy: { select: { name: true } },
              createdBy: { select: { name: true } },
              vehicleOrCourierReference: true,
              driver: { select: { name: true } },
              assistant: { select: { name: true } },
              vehicle: { select: { registrationNumber: true } },
              lines: {
                select: {
                  dispatchedQuantity: true,
                  orderLine: { select: { originalProductDescription: true, sapItemCodeSnapshot: true, matchedSapInvoiceLines: { select: { quantityInvoiced: true } } } },
                },
              },
              deliveryRecord: {
                select: {
                  outcome: true,
                  recordedAt: true,
                  recipientName: true,
                  recordedBy: { select: { name: true } },
                  lines: {
                    select: {
                      acceptedQuantity: true,
                      rejectedQuantity: true,
                      rejectionReason: true,
                      dispatchLine: { select: { orderLine: { select: { originalProductDescription: true, sapItemCodeSnapshot: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!sapInvoice) return null;

  const order = sapInvoice.matchedOrder;

  const purchaseOrder = order
    ? {
        customerId: order.customer.id,
        customerName: order.customer.name,
        customerSapCode: order.customer.sapCustomerCode,
        orderId: order.id,
        orderReference: order.reference,
        customerPoReference: order.customerPoReference,
        orderDate: order.orderDate?.toISOString() ?? null,
        receivedAt: order.receivedAt?.toISOString() ?? null,
        salespersonName: order.salesperson?.name ?? null,
        originalSourceText: order.originalSourceText,
        currency: order.currency,
        lines: order.lines.map((l) => ({
          lineNumber: l.lineNumber,
          sapItemCode: l.sapItemCodeSnapshot,
          description: l.originalProductDescription,
          requestedQuantity: l.requestedQuantity.toString(),
          unitPrice: (l.approvedUnitPrice ?? l.customerUnitPrice)?.toString() ?? null,
          lineTotal: l.lineTotal?.toString() ?? null,
        })),
      }
    : null;

  const pickingSessions = (order?.pickingSessions ?? []).map((session) => ({
    id: session.id,
    status: session.status,
    startedByName: session.startedBy.name,
    startedAt: session.startedAt.toISOString(),
    completedByName: session.completedBy?.name ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    authorizedByName: session.authorizedBy?.name ?? null,
    authorizedAt: session.authorizedAt?.toISOString() ?? null,
    lines: session.lines.map((line) => ({
      description: line.orderLine.originalProductDescription,
      sapItemCode: line.orderLine.sapItemCodeSnapshot,
      requestedQuantity: line.requestedQuantity.toString(),
      foundQuantity: line.foundQuantity?.toString() ?? null,
      unavailableQuantity: line.unavailableQuantity?.toString() ?? null,
      pickedByName: line.pickedBy?.name ?? null,
      pickedAt: line.pickedAt?.toISOString() ?? null,
    })),
  }));

  const invoice = {
    sapDocNum: sapInvoice.sapDocNum,
    invoiceDate: sapInvoice.invoiceDate?.toISOString() ?? null,
    currencyCode: sapInvoice.currencyCode,
    total: sapInvoice.total?.toString() ?? null,
    reconciliationStatus: sapInvoice.reconciliationStatus,
    isCancelledOrReversed: sapInvoice.isCancelledOrReversed,
    isNativelyRecorded: isNativelyRecordedInvoice(sapInvoice.rawSourceData),
    lines: sapInvoice.lines.map((l) => ({
      lineNumber: l.lineNumber,
      sapItemCode: l.sapItemCode,
      description: l.sapItemDescription,
      quantityInvoiced: l.quantityInvoiced.toString(),
      unitPrice: l.unitPrice?.toString() ?? null,
      lineTotal: l.lineTotal?.toString() ?? null,
    })),
  };

  const dispatches = (order?.dispatchRecords ?? []).map((dispatch) => ({
    id: dispatch.id,
    status: dispatch.status,
    driverName: dispatch.driver?.name ?? null,
    assistantName: dispatch.assistant?.name ?? null,
    vehicleRegistration: dispatch.vehicle?.registrationNumber ?? null,
    vehicleOrCourierReference: dispatch.vehicleOrCourierReference,
    plannedDepartureAt: dispatch.plannedDepartureAt?.toISOString() ?? null,
    departedAt: dispatch.departedAt?.toISOString() ?? null,
    departedByName: dispatch.departedBy?.name ?? null,
    createdByName: dispatch.createdBy.name,
    lines: dispatch.lines.map((line) => ({
      description: line.orderLine.originalProductDescription,
      sapItemCode: line.orderLine.sapItemCodeSnapshot,
      // Informational only -- the FIRST matched SAP invoice line's
      // quantityInvoiced for this order line, when one has been matched.
      // An order line can in principle match more than one SAP invoice
      // line (partial invoicing); this surfaces a representative figure
      // for the "invoiced vs dispatched" comparison the spec asks for,
      // not a second source of truth for reconciliation math (that
      // remains lib/invoice-reconciliation/reconcile.ts's job).
      invoicedQuantity: line.orderLine.matchedSapInvoiceLines[0]?.quantityInvoiced?.toString() ?? null,
      dispatchedQuantity: line.dispatchedQuantity.toString(),
    })),
    physicalDelivery: dispatch.deliveryRecord
      ? {
          outcome: dispatch.deliveryRecord.outcome,
          recordedByName: dispatch.deliveryRecord.recordedBy.name,
          recordedAt: dispatch.deliveryRecord.recordedAt.toISOString(),
          recipientName: dispatch.deliveryRecord.recipientName,
          lines: dispatch.deliveryRecord.lines.map((line) => ({
            description: line.dispatchLine.orderLine.originalProductDescription,
            acceptedQuantity: line.acceptedQuantity.toString(),
            rejectedQuantity: line.rejectedQuantity.toString(),
            rejectionReason: line.rejectionReason,
          })),
        }
      : null,
  }));

  const claims = deliveryRecord.claims.map((claim) => ({
    id: claim.id,
    claimReference: claim.claimReference,
    status: claim.status,
    category: claim.category,
    description: claim.description,
    reportedByName: claim.reportedBy.name,
    createdAt: claim.createdAt.toISOString(),
    lines: claim.lines.map((line) => ({
      sapItemCode: line.sapItemCodeSnapshot,
      description: line.sapItemDescriptionSnapshot,
      reasonCategory: line.reasonCategory,
      reasonLabel: line.reasonCategory ? CLAIM_LINE_REASON_CATEGORY_LABELS[line.reasonCategory as AnyStoredClaimLineReasonCategory] ?? line.reasonCategory : null,
      disputeType: line.disputeType,
      acceptedQuantity: line.acceptedQuantity?.toString() ?? null,
      rejectedQuantity: line.rejectedQuantity?.toString() ?? null,
      disputedAmount: line.disputedAmount?.toString() ?? null,
      disputedUnitPrice: line.disputedUnitPrice?.toString() ?? null,
      reason: line.reason,
    })),
    attachmentCount: claim.attachments.length,
  }));

  // (G) People -- every distinct named person this order's record
  // actually names, by role. Never invented: a role with nobody on
  // record for it (e.g. no dispatch ever recorded) is simply absent.
  const people: { role: string; name: string }[] = [];
  if (order?.salesperson?.name) people.push({ role: "Salesperson", name: order.salesperson.name });
  for (const session of pickingSessions) {
    people.push({ role: "Picking - started", name: session.startedByName });
    if (session.completedByName) people.push({ role: "Picking - completed", name: session.completedByName });
    if (session.authorizedByName) people.push({ role: "Picking - authorized", name: session.authorizedByName });
  }
  for (const dispatch of dispatches) {
    people.push({ role: "Dispatch - created by", name: dispatch.createdByName });
    if (dispatch.departedByName) people.push({ role: "Dispatch - departed, recorded by", name: dispatch.departedByName });
    if (dispatch.driverName) people.push({ role: "Driver", name: dispatch.driverName });
    if (dispatch.assistantName) people.push({ role: "Driver's assistant", name: dispatch.assistantName });
    if (dispatch.physicalDelivery) people.push({ role: "Physical delivery - recorded by", name: dispatch.physicalDelivery.recordedByName });
  }
  people.push({ role: "Delivery outcome - recorded by", name: deliveryRecord.recordedBy.name });
  for (const claim of claims) people.push({ role: "Claim - reported by", name: claim.reportedByName });
  // De-duplicate identical (role, name) pairs -- e.g. the same person
  // started and completed the same picking session.
  const seenPeople = new Set<string>();
  const dedupedPeople = people.filter((p) => {
    const key = `${p.role}::${p.name}`;
    if (seenPeople.has(key)) return false;
    seenPeople.add(key);
    return true;
  });

  // (H) Durations. Each uses the EARLIEST relevant picking session /
  // FIRST non-cancelled dispatch where more than one exists -- a
  // documented approximation for an order re-picked or dispatched in
  // several parts; see this module's own top comment.
  const firstPicking = pickingSessions[0] ?? null;
  const firstDispatch = dispatches[0] ?? null;
  const durations: DurationResult[] = [
    duration("PO received to order created", "PO received", order?.receivedAt ? new Date(order.receivedAt) : null, "Order created", order ? order.createdAt : null),
    duration(
      "Order created to picking started",
      "Order created",
      order ? order.createdAt : null,
      "Picking started",
      firstPicking ? new Date(firstPicking.startedAt) : null
    ),
    duration(
      "Picking started to picking completed",
      "Picking started",
      firstPicking ? new Date(firstPicking.startedAt) : null,
      "Picking completed",
      firstPicking?.completedAt ? new Date(firstPicking.completedAt) : null
    ),
    duration(
      "Picking completed to invoice recorded",
      "Picking completed",
      firstPicking?.completedAt ? new Date(firstPicking.completedAt) : null,
      "Invoice date",
      sapInvoice.invoiceDate ? new Date(sapInvoice.invoiceDate) : null
    ),
    duration(
      "Invoice recorded to dispatch",
      "Invoice date",
      sapInvoice.invoiceDate ? new Date(sapInvoice.invoiceDate) : null,
      "Dispatch departed",
      firstDispatch?.departedAt ? new Date(firstDispatch.departedAt) : null
    ),
    duration(
      "Dispatch to delivery outcome recorded",
      "Dispatch departed",
      firstDispatch?.departedAt ? new Date(firstDispatch.departedAt) : null,
      "Delivery outcome recorded",
      new Date(deliveryRecord.recordedAt)
    ),
    duration(
      "Total: PO to delivery",
      "PO received",
      order?.receivedAt ? new Date(order.receivedAt) : null,
      "Delivery outcome recorded",
      new Date(deliveryRecord.recordedAt)
    ),
  ];
  return {
    sapInvoiceId,
    purchaseOrder,
    pickingSessions,
    invoice,
    dispatches,
    deliveryOutcome: {
      id: deliveryRecord.id,
      outcome: deliveryRecord.outcome,
      podReference: deliveryRecord.podReference,
      notes: deliveryRecord.notes,
      recordedByName: deliveryRecord.recordedBy.name,
      recordedAt: deliveryRecord.recordedAt.toISOString(),
    },
    claims,
    people: dedupedPeople,
    durations,
  };
}
