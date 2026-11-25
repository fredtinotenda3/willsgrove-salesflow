/**
 * Shared, transaction-scoped delete groups for this project's database
 * reset scripts (scripts/reset-operational-data.ts and
 * scripts/reset-to-user-and-product.ts). Extracted into its own module so
 * the carefully-ordered, carefully-commented 47-delete "operational data"
 * group is defined exactly once -- previously it lived only inside
 * reset-operational-data.ts's own transaction callback. Duplicating that
 * block into a second, broader reset script would have meant two
 * independently-maintained copies of the same FK-order-sensitive logic
 * that could silently drift apart after a future schema change; extracting
 * it here means a schema change that adds a new model only needs this one
 * place updated, and both scripts stay in lockstep automatically.
 *
 * This file is impure (every export takes a live PrismaTransactionClient
 * and issues real deletes) -- like every other Prisma-backed module in
 * this codebase, it has no unit test of its own; its correctness rests on
 * the FK-order reasoning documented inline below, cross-checked directly
 * against prisma/schema.prisma's actual onDelete declarations for every
 * model touched (not against any external plan document). The pure
 * argument-parsing/confirmation-guard logic that wraps these calls is
 * covered by tests/db-reset-args.test.ts instead.
 */
import type { PrismaTransactionClient } from "@/lib/prisma";

export type DeleteCounts = Record<string, number>;

/**
 * Deletes every row from every operational/transactional table -- demo and
 * real alike -- while leaving master/reference data (User, Customer,
 * Product, TaxCode, PriceList/PriceListEntry, Personnel, Vehicle), two
 * configuration singletons (ApprovalPolicy, IntegrationConnection),
 * Session, and AuditEvent completely untouched. This is exactly what
 * scripts/reset-operational-data.ts has always done; moved here verbatim
 * (same 47 deletes, same order, same comments) so
 * scripts/reset-to-user-and-product.ts can reuse it as its own first phase
 * rather than re-deriving the same FK order a second time.
 *
 * Deletion order: every FK in this schema declares onDelete explicitly, and
 * the overwhelming majority are Restrict (a child row must be gone, or its
 * FK nulled if nullable, before its parent can be deleted). Because every
 * delete below is a full, unfiltered deleteMany({}) -- never a scoped
 * subset like remove-demo-data.ts's isDemo-filtered deletes -- the four
 * self-referential FKs in this schema (Quotation.previousRevisionId,
 * ApprovalRequest.previousRequestId, UnfulfilledDemand.supersededByDemandId,
 * MessageIntake.duplicateOfId) need no special null-out step: Postgres
 * evaluates FK constraints only after a whole DELETE statement completes,
 * not row-by-row, so an entire self-referencing table empties cleanly in
 * one statement regardless of chain order. Each group comment below states
 * the specific Restrict FK(s) that require it to come before (or after) a
 * named later (or earlier) group.
 */
export async function deleteOperationalData(tx: PrismaTransactionClient): Promise<DeleteCounts> {
  // Decision intelligence. Deleted first: DecisionRecommendation holds
  // Restrict FKs onto Quotation/CustomerOrder (both deleted much
  // further down), and DecisionRecommendationEvent holds a Restrict FK
  // back to DecisionRecommendation.
  const decisionRecommendationEvents = await tx.decisionRecommendationEvent.deleteMany({});
  const decisionRecommendations = await tx.decisionRecommendation.deleteMany({});

  // Communications & fulfilment. MessageIntake holds Restrict FKs onto
  // OrderDocument/CustomerOrder/Quotation (all deleted further down);
  // DispatchRecord holds a Restrict FK onto CustomerOrder. Within the
  // group: MessageAttachment before MessageIntake (Cascade, explicit
  // for a clean count); DeliveryLine before DeliveryRecord (Cascade)
  // and before DispatchLine (Restrict, via DeliveryLine.dispatchLineId);
  // DeliveryRecord before DispatchRecord (Restrict, unique); DispatchLine
  // before OrderLine further down (Restrict) and before DispatchRecord
  // (Cascade). OutboundMessage's own FKs to CustomerOrder/Quotation/
  // DispatchRecord/DeliveryRecord are all SetNull (no ordering
  // requirement) but it is grouped here for readability.
  const messageAttachments = await tx.messageAttachment.deleteMany({});
  const outboundMessages = await tx.outboundMessage.deleteMany({});
  const messageIntakes = await tx.messageIntake.deleteMany({});
  const deliveryLines = await tx.deliveryLine.deleteMany({});
  const deliveryRecords = await tx.deliveryRecord.deleteMany({});
  const dispatchLines = await tx.dispatchLine.deleteMany({});
  const dispatchRecords = await tx.dispatchRecord.deleteMany({});

  // Approvals & notifications. ApprovalRequest holds Restrict FKs onto
  // Quotation/CustomerOrder (deleted further down); ApprovalEvent holds
  // a Restrict FK back to ApprovalRequest. ApprovalPolicy itself is
  // preserved here (config, not a transaction) -- ApprovalRequest.policyId
  // is SetNull, so leaving ApprovalPolicy rows in place is never
  // blocked by this delete. Notification has no dependents and no
  // ordering requirement; grouped here for readability only.
  const approvalEvents = await tx.approvalEvent.deleteMany({});
  const approvalRequests = await tx.approvalRequest.deleteMany({});
  const notifications = await tx.notification.deleteMany({});

  // Quotations. QuotationEvent/QuotationLine both hold Restrict FKs
  // back to Quotation; Quotation itself holds a Restrict FK onto
  // CustomerOrder (convertedOrderId), deleted much further down.
  const quotationEvents = await tx.quotationEvent.deleteMany({});
  const quotationLines = await tx.quotationLine.deleteMany({});
  const quotations = await tx.quotation.deleteMany({});

  // Document extraction. ExtractedOrderLine holds a Restrict FK back to
  // ExtractionRun; ExtractionRun holds a Restrict FK onto OrderDocument
  // (deleted in the next group).
  const extractedOrderLines = await tx.extractedOrderLine.deleteMany({});
  const extractionRuns = await tx.extractionRun.deleteMany({});

  // Legacy order-review trio & order history. ProductVerification/
  // PriceDecision hold Restrict FKs onto OrderLine (deleted much
  // further down); OrderApproval/OrderStatusHistory/OrderDocument/
  // OrderHandover all hold Restrict FKs onto CustomerOrder (deleted
  // much further down). OrderDocument must come after ExtractionRun
  // (just above), which references it.
  const productVerifications = await tx.productVerification.deleteMany({});
  const priceDecisions = await tx.priceDecision.deleteMany({});
  const orderApprovals = await tx.orderApproval.deleteMany({});
  const orderStatusHistories = await tx.orderStatusHistory.deleteMany({});
  const orderDocuments = await tx.orderDocument.deleteMany({});
  const orderHandovers = await tx.orderHandover.deleteMany({});

  // Lost sales. CustomerDecisionEvent/LostSaleRecord both hold Restrict
  // FKs back to UnfulfilledDemand; UnfulfilledDemand itself holds
  // Restrict FKs onto CustomerOrder/OrderLine/PickingSession/
  // PickingLine (all deleted further down/next), so this whole group
  // must precede all four.
  const customerDecisionEvents = await tx.customerDecisionEvent.deleteMany({});
  const lostSaleRecords = await tx.lostSaleRecord.deleteMany({});
  const unfulfilledDemands = await tx.unfulfilledDemand.deleteMany({});

  // Picking. PickingLine holds a Restrict FK onto OrderLine (deleted
  // much further down); PickingSession holds a Restrict FK onto
  // CustomerOrder (deleted much further down). Must come after
  // UnfulfilledDemand just above (which references both).
  const pickingLines = await tx.pickingLine.deleteMany({});
  const pickingSessions = await tx.pickingSession.deleteMany({});

  // Claims & credit notes. ClaimReturn references InvoiceClaim/
  // InvoiceClaimLine/CreditNote (all Restrict) so it goes first in this
  // group. InvoiceClaimAttachment references InvoiceClaim/
  // InvoiceClaimLine (Restrict). ClaimResolution references InvoiceClaim
  // (Restrict). CreditNote references CreditNoteImportBatch/SapInvoice/
  // InvoiceClaim (all Restrict, nullable) so it must precede all three.
  // InvoiceClaimLine references InvoiceClaim/SapInvoiceLine (Restrict).
  // InvoiceClaim references SapInvoice/CustomerOrder (Restrict).
  // InvoiceDeliveryRecord references SapInvoice (Restrict, unique);
  // InvoiceClaim.invoiceDeliveryRecordId -> InvoiceDeliveryRecord is
  // SetNull, so no ordering constraint runs the other way.
  // ClaimReturnLostSale holds Restrict FKs onto ClaimReturn, InvoiceClaim,
  // InvoiceClaimLine and Customer, so it must go before all three claim
  // tables below (it was missing from this function until now, which made
  // the whole reset roll back whenever a return had recorded a lost sale).
  const claimReturnLostSales = await tx.claimReturnLostSale.deleteMany({});
  const claimReturns = await tx.claimReturn.deleteMany({});
  const invoiceClaimAttachments = await tx.invoiceClaimAttachment.deleteMany({});
  const claimResolutions = await tx.claimResolution.deleteMany({});
  const creditNotes = await tx.creditNote.deleteMany({});
  const invoiceClaimLines = await tx.invoiceClaimLine.deleteMany({});
  const invoiceClaims = await tx.invoiceClaim.deleteMany({});
  const invoiceDeliveryRecords = await tx.invoiceDeliveryRecord.deleteMany({});

  // SAP invoice reconciliation. SapInvoiceLine references SapInvoice/
  // CustomerOrder/OrderLine (Restrict, nullable) -- must come before
  // SapInvoice (next) and before OrderLine (much further down).
  // SapInvoice references SapInvoiceImportBatch (Restrict). CreditNote
  // (deleted above, in the claims group) already precedes both, since
  // it references SapInvoice and CreditNoteImportBatch.
  const sapInvoiceLines = await tx.sapInvoiceLine.deleteMany({});
  const sapInvoices = await tx.sapInvoice.deleteMany({});
  const sapInvoiceImportBatches = await tx.sapInvoiceImportBatch.deleteMany({});
  const creditNoteImportBatches = await tx.creditNoteImportBatch.deleteMany({});

  // SAP integration activity log. IntegrationOperation references
  // IntegrationSyncJob (Restrict, nullable) and CustomerOrder (Restrict,
  // unique) -- must precede both. IntegrationConnection itself is
  // preserved config here and is never touched by this function.
  const integrationOperations = await tx.integrationOperation.deleteMany({});
  const integrationSyncJobs = await tx.integrationSyncJob.deleteMany({});

  // Learned extraction aliases. Only Cascade (to preserved Customer/
  // Product) and Restrict-to-preserved-User FKs -- no ordering
  // requirement against any other group in this function.
  const productAliases = await tx.productAlias.deleteMany({});
  const customerAliases = await tx.customerAlias.deleteMany({});

  // The order pipeline itself. OrderLine holds a Restrict FK onto
  // CustomerOrder, so it must be deleted first. By this point every
  // other model with a Restrict FK onto OrderLine or CustomerOrder
  // (DispatchLine, PickingLine, ProductVerification, PriceDecision,
  // UnfulfilledDemand, SapInvoiceLine, Quotation, ApprovalRequest,
  // DecisionRecommendation, MessageIntake, OrderApproval,
  // OrderStatusHistory, OrderDocument, OrderHandover, PickingSession,
  // DispatchRecord, InvoiceClaim, IntegrationOperation) has already
  // been deleted above.
  const orderLines = await tx.orderLine.deleteMany({});
  const customerOrders = await tx.customerOrder.deleteMany({});

  // Stock snapshots. Fully independent of the CustomerOrder graph.
  // StockSnapshotLine references StockSnapshot (Restrict) and Product
  // (Restrict, but Product is preserved and untouched, so this is
  // never blocked) -- must precede StockSnapshot.
  const stockSnapshotLines = await tx.stockSnapshotLine.deleteMany({});
  const stockSnapshots = await tx.stockSnapshot.deleteMany({});

  // Management actions. Findings/evidence snapshots derived from the data
  // being wiped; they only reference User (preserved). Event rows hold a
  // Restrict FK back to the action, so events first.
  const managementActionEvents = await tx.managementActionEvent.deleteMany({});
  const managementActions = await tx.managementAction.deleteMany({});

  return {
    decisionRecommendationEvents: decisionRecommendationEvents.count,
    decisionRecommendations: decisionRecommendations.count,
    messageAttachments: messageAttachments.count,
    outboundMessages: outboundMessages.count,
    messageIntakes: messageIntakes.count,
    deliveryLines: deliveryLines.count,
    deliveryRecords: deliveryRecords.count,
    dispatchLines: dispatchLines.count,
    dispatchRecords: dispatchRecords.count,
    approvalEvents: approvalEvents.count,
    approvalRequests: approvalRequests.count,
    notifications: notifications.count,
    quotationEvents: quotationEvents.count,
    quotationLines: quotationLines.count,
    quotations: quotations.count,
    extractedOrderLines: extractedOrderLines.count,
    extractionRuns: extractionRuns.count,
    productVerifications: productVerifications.count,
    priceDecisions: priceDecisions.count,
    orderApprovals: orderApprovals.count,
    orderStatusHistories: orderStatusHistories.count,
    orderDocuments: orderDocuments.count,
    orderHandovers: orderHandovers.count,
    customerDecisionEvents: customerDecisionEvents.count,
    lostSaleRecords: lostSaleRecords.count,
    unfulfilledDemands: unfulfilledDemands.count,
    pickingLines: pickingLines.count,
    pickingSessions: pickingSessions.count,
    claimReturnLostSales: claimReturnLostSales.count,
    claimReturns: claimReturns.count,
    invoiceClaimAttachments: invoiceClaimAttachments.count,
    claimResolutions: claimResolutions.count,
    creditNotes: creditNotes.count,
    invoiceClaimLines: invoiceClaimLines.count,
    invoiceClaims: invoiceClaims.count,
    invoiceDeliveryRecords: invoiceDeliveryRecords.count,
    sapInvoiceLines: sapInvoiceLines.count,
    sapInvoices: sapInvoices.count,
    sapInvoiceImportBatches: sapInvoiceImportBatches.count,
    creditNoteImportBatches: creditNoteImportBatches.count,
    integrationOperations: integrationOperations.count,
    integrationSyncJobs: integrationSyncJobs.count,
    productAliases: productAliases.count,
    customerAliases: customerAliases.count,
    orderLines: orderLines.count,
    customerOrders: customerOrders.count,
    stockSnapshotLines: stockSnapshotLines.count,
    stockSnapshots: stockSnapshots.count,
    managementActionEvents: managementActionEvents.count,
    managementActions: managementActions.count,
  };
}

/**
 * Deletes every remaining master/reference and configuration table except
 * User and Product -- the second phase of
 * scripts/reset-to-user-and-product.ts, run strictly AFTER
 * deleteOperationalData() above (every table this function touches is
 * either independent of the operational graph or is a PARENT of something
 * deleteOperationalData() already removed, so this function must run
 * second, never first, never concurrently).
 *
 * FK order within this function (cross-checked directly against
 * prisma/schema.prisma's onDelete declarations):
 *   - CustomerContact -> Customer and CustomerLocation -> Customer are
 *     both onDelete: Restrict, so both must be deleted before Customer.
 *     Every OTHER model with a Restrict FK onto Customer (CustomerOrder,
 *     UnfulfilledDemand, InvoiceClaim, Quotation, MessageIntake,
 *     DecisionRecommendation) was already deleted by
 *     deleteOperationalData() above; CustomerAlias/ProductAlias (Cascade)
 *     were too.
 *   - PriceListEntry -> PriceList is onDelete: Restrict, so entries must
 *     be deleted before the price list itself. PriceListEntry -> Product
 *     is onDelete: SetNull, and Product is preserved, so this is never
 *     blocked. Customer.priceListId -> PriceList is onDelete: SetNull
 *     (confirmed in scripts/remove-demo-data.ts's own module comment), so
 *     there is no ordering requirement between Customer and PriceList.
 *   - TaxCode has zero incoming foreign keys anywhere in this schema
 *     (Product.vatCode is a plain string, not a relation -- same
 *     confirmed fact scripts/remove-demo-data.ts's module comment
 *     documents) -- deleted independently, any time.
 *   - Personnel and Vehicle are each referenced only by
 *     DispatchRecord.driver/assistant/vehicle (all onDelete: Restrict),
 *     and DispatchRecord was already deleted by deleteOperationalData()
 *     above. Personnel.createdBy/statusChangedBy and
 *     Vehicle.createdBy/statusChangedBy both reference User (Restrict),
 *     which is preserved, so that direction is never blocked either.
 *   - ApprovalPolicy is referenced only by ApprovalRequest.policyId
 *     (onDelete: SetNull), and ApprovalRequest was already deleted by
 *     deleteOperationalData() above -- no ordering requirement either way.
 *   - IntegrationConnection has no incoming foreign keys anywhere in this
 *     schema (confirmed by a full-repo check: no other model declares a
 *     relation field of type IntegrationConnection) -- deleted
 *     independently, any time.
 *   - Session has no incoming foreign keys (only its own outgoing,
 *     onDelete: Cascade, FK to User, which is preserved) -- deleted
 *     independently, any time.
 *   - AuditEvent has no incoming foreign keys anywhere in this schema
 *     (every other model only ever references it narratively in
 *     comments, never via an actual relation field) -- deleted last,
 *     independently of everything else in this function. This function
 *     deletes every existing AuditEvent row; the CALLER is responsible
 *     for writing exactly one new AuditEvent row documenting the reset
 *     itself immediately afterward, inside the same transaction (see
 *     scripts/reset-to-user-and-product.ts) -- this function stays a
 *     pure "delete and count" operation with no opinion on what the
 *     caller logs.
 */
export async function deleteMasterDataExceptUserAndProduct(tx: PrismaTransactionClient): Promise<DeleteCounts> {
  // Customer family. Contacts and locations before the customer itself.
  const customerContacts = await tx.customerContact.deleteMany({});
  const customerLocations = await tx.customerLocation.deleteMany({});
  const customers = await tx.customer.deleteMany({});

  // Price lists. Entries before the list itself.
  const priceListEntries = await tx.priceListEntry.deleteMany({});
  const priceLists = await tx.priceList.deleteMany({});

  // Tax codes. No incoming FKs -- independent.
  const taxCodes = await tx.taxCode.deleteMany({});

  // Personnel & vehicle registers. Their only dependents (DispatchRecord)
  // were deleted by deleteOperationalData() above.
  const personnel = await tx.personnel.deleteMany({});
  const vehicles = await tx.vehicle.deleteMany({});

  // Configuration singletons. Their only dependent (ApprovalRequest /
  // nothing, respectively) was already handled above.
  const approvalPolicies = await tx.approvalPolicy.deleteMany({});
  const integrationConnections = await tx.integrationConnection.deleteMany({});

  // Auth sessions. Forces every signed-in user to log back in -- expected
  // and harmless after a full reset.
  const sessions = await tx.session.deleteMany({});

  // Audit log. Deleted last, and last in this function specifically so
  // the caller's own post-reset AuditEvent write (see this function's own
  // doc comment) is the only row left standing once this transaction
  // commits.
  const auditEvents = await tx.auditEvent.deleteMany({});

  return {
    customerContacts: customerContacts.count,
    customerLocations: customerLocations.count,
    customers: customers.count,
    priceListEntries: priceListEntries.count,
    priceLists: priceLists.count,
    taxCodes: taxCodes.count,
    personnel: personnel.count,
    vehicles: vehicles.count,
    approvalPolicies: approvalPolicies.count,
    integrationConnections: integrationConnections.count,
    sessions: sessions.count,
    auditEvents: auditEvents.count,
  };
}
