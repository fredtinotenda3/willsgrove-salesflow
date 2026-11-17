/**
 * Operational data reset — a different, broader tool than
 * `scripts/remove-demo-data.ts` (`npm run db:remove-demo`).
 *
 * `remove-demo-data.ts` deletes only rows flagged `isDemo: true` and never
 * touches master data. THIS script deletes every row -- demo and real alike
 * -- from every operational/transactional table, while leaving master data
 * (User, Customer, Product, TaxCode, PriceList/PriceListEntry, Personnel,
 * Vehicle), two configuration singletons (ApprovalPolicy, IntegrationConnection),
 * Session, and AuditEvent completely untouched. The full reasoning for what
 * is preserved vs. wiped, the complete FK dependency map this deletion order
 * is derived from, the one genuine judgment call (ProductAlias/CustomerAlias),
 * and the rollback procedure all live in DATABASE-CLEANUP-PLAN.md at the
 * project root -- read that document before running this script, not just
 * this comment.
 *
 * THIS SCRIPT HAS NEVER BEEN RUN. It cannot be run in the sandbox this
 * delivery was produced in (no live database access -- see
 * FINAL-IMPLEMENTATION-REPORT.md), and must never be run against any real
 * or seeded database without a human first reading DATABASE-CLEANUP-PLAN.md
 * in full, confirming a real backup exists, and explicitly deciding to
 * proceed. Never wire this into any automated path (deploy, migration,
 * seed, startup, cron) -- it exists to be run once, deliberately, by a
 * human at a terminal with real database access.
 *
 * Safety mechanisms (see DATABASE-CLEANUP-PLAN.md section 4 for the summary
 * a reviewer can check this against):
 *   1. Admin-gated: --actor must name a real User row with role
 *      ADMINISTRATOR and status ACTIVE, validated against the database
 *      before anything else happens.
 *   2. Dry-run first: --dry-run prints full per-table counts and a grand
 *      total, changing nothing.
 *   3. The real run requires --confirm-total-rows=<N> to match a FRESH
 *      recount taken at run time (not the dry run's cached number) -- a
 *      stale or copy-pasted command from a different moment or environment
 *      is refused rather than silently deleting a different amount of data
 *      than the operator actually reviewed.
 *   4. Backup-required: --backup-reference="<description>" must be a
 *      non-empty description of what backup was taken and when, recorded
 *      verbatim in the terminal AuditEvent so the backup that was attested
 *      to is permanently tied to the reset it preceded.
 *   5. Confirmation-required: --confirm must equal the exact literal phrase
 *      CONFIRM_PHRASE below.
 *   6. Transactional: all 47 deletes plus the terminal AuditEvent run in one
 *      prisma.$transaction -- a failure partway through leaves the database
 *      exactly as it was.
 *   7. Idempotent/guarded: every delete is an unconditional deleteMany({})
 *      on its table; running this again against an already-empty
 *      operational dataset is a safe no-op.
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
 * named later (or earlier) group; the full per-model FK list this was
 * derived from is in DATABASE-CLEANUP-PLAN.md section 2.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  CONFIRM_PHRASE,
  checkRealRunGuards,
  parseResetArgs,
  totalOfCounts,
  type ParsedResetArgs,
} from "@/lib/db-reset-args";

// Same reasoning as remove-demo-data.ts: this is 47+ sequential round trips
// over one connection to a pooled Neon endpoint (more than that script's
// ~40, since this one also covers StockSnapshot/PickingSession/
// OrderHandover/UnfulfilledDemand/InvoiceDeliveryRecord/ExtractionRun/
// ProductAlias groups it doesn't), well past Prisma's 5000ms default
// interactive-transaction timeout. Kept strictly sequential rather than
// Promise.all -- Prisma documents concurrent queries against one
// interactive-transaction client as unsafe, since they share one
// underlying connection not guaranteed safe for concurrent use. The
// timeout is raised instead, which is what Prisma's own docs recommend for
// a transaction that is simply slower than the default allows.
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

function printUsageAndExit(message: string): never {
  console.error(`ERROR: ${message}\n`);
  console.error("Usage:");
  console.error("  Dry run (no changes):");
  console.error("    npm run db:reset-operational-data -- --actor=<admin-user-id> --dry-run\n");
  console.error("  Real run (after reviewing the dry run's output):");
  console.error("    npm run db:reset-operational-data -- \\");
  console.error("      --actor=<admin-user-id> \\");
  console.error('      --backup-reference="<what backup was taken, and when>" \\');
  console.error(`      --confirm="${CONFIRM_PHRASE}" \\`);
  console.error("      --confirm-total-rows=<N, from the dry run's grand total>\n");
  console.error("See DATABASE-CLEANUP-PLAN.md for the full plan before running this for real.");
  process.exitCode = 1;
  return process.exit(1);
}

function printTargetDatabase(): void {
  const raw = process.env.DATABASE_URL ?? "";
  let host = "(DATABASE_URL not set)";
  try {
    const url = new URL(raw);
    host = `${url.hostname}${url.pathname}`;
  } catch {
    // leave the fallback message
  }
  console.log(`Target database: ${host}`);
  console.log("Confirm this is the environment you intend before proceeding.\n");
}

async function validateAdminActor(actorId: string): Promise<{ id: string; name: string; email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { id: true, name: true, email: true, role: true, status: true },
  });
  if (!user) {
    printUsageAndExit(`--actor "${actorId}" does not match any User row.`);
  }
  if (user.role !== "ADMINISTRATOR") {
    printUsageAndExit(`--actor "${actorId}" (${user.email}) has role ${user.role}, not ADMINISTRATOR.`);
  }
  if (user.status !== "ACTIVE") {
    printUsageAndExit(`--actor "${actorId}" (${user.email}) has status ${user.status}, not ACTIVE.`);
  }
  return { id: user.id, name: user.name, email: user.email };
}

// Every table in DATABASE-CLEANUP-PLAN.md section 3's "Wiped" list, counted
// with Prisma's own client -- used for both --dry-run and the fresh
// recount that --confirm-total-rows is checked against. Order matches the
// deletion order below purely for readability; count() has no ordering
// requirement of its own.
async function countOperationalRows(): Promise<Record<string, number>> {
  const [
    decisionRecommendationEvents,
    decisionRecommendations,
    messageAttachments,
    outboundMessages,
    messageIntakes,
    deliveryLines,
    deliveryRecords,
    dispatchLines,
    dispatchRecords,
    approvalEvents,
    approvalRequests,
    notifications,
    quotationEvents,
    quotationLines,
    quotations,
    extractedOrderLines,
    extractionRuns,
    productVerifications,
    priceDecisions,
    orderApprovals,
    orderStatusHistories,
    orderDocuments,
    orderHandovers,
    customerDecisionEvents,
    lostSaleRecords,
    unfulfilledDemands,
    pickingLines,
    pickingSessions,
    claimReturns,
    invoiceClaimAttachments,
    claimResolutions,
    creditNotes,
    invoiceClaimLines,
    invoiceClaims,
    invoiceDeliveryRecords,
    sapInvoiceLines,
    sapInvoices,
    sapInvoiceImportBatches,
    creditNoteImportBatches,
    integrationOperations,
    integrationSyncJobs,
    productAliases,
    customerAliases,
    orderLines,
    customerOrders,
    stockSnapshotLines,
    stockSnapshots,
  ] = await Promise.all([
    prisma.decisionRecommendationEvent.count(),
    prisma.decisionRecommendation.count(),
    prisma.messageAttachment.count(),
    prisma.outboundMessage.count(),
    prisma.messageIntake.count(),
    prisma.deliveryLine.count(),
    prisma.deliveryRecord.count(),
    prisma.dispatchLine.count(),
    prisma.dispatchRecord.count(),
    prisma.approvalEvent.count(),
    prisma.approvalRequest.count(),
    prisma.notification.count(),
    prisma.quotationEvent.count(),
    prisma.quotationLine.count(),
    prisma.quotation.count(),
    prisma.extractedOrderLine.count(),
    prisma.extractionRun.count(),
    prisma.productVerification.count(),
    prisma.priceDecision.count(),
    prisma.orderApproval.count(),
    prisma.orderStatusHistory.count(),
    prisma.orderDocument.count(),
    prisma.orderHandover.count(),
    prisma.customerDecisionEvent.count(),
    prisma.lostSaleRecord.count(),
    prisma.unfulfilledDemand.count(),
    prisma.pickingLine.count(),
    prisma.pickingSession.count(),
    prisma.claimReturn.count(),
    prisma.invoiceClaimAttachment.count(),
    prisma.claimResolution.count(),
    prisma.creditNote.count(),
    prisma.invoiceClaimLine.count(),
    prisma.invoiceClaim.count(),
    prisma.invoiceDeliveryRecord.count(),
    prisma.sapInvoiceLine.count(),
    prisma.sapInvoice.count(),
    prisma.sapInvoiceImportBatch.count(),
    prisma.creditNoteImportBatch.count(),
    prisma.integrationOperation.count(),
    prisma.integrationSyncJob.count(),
    prisma.productAlias.count(),
    prisma.customerAlias.count(),
    prisma.orderLine.count(),
    prisma.customerOrder.count(),
    prisma.stockSnapshotLine.count(),
    prisma.stockSnapshot.count(),
  ]);

  return {
    decisionRecommendationEvents,
    decisionRecommendations,
    messageAttachments,
    outboundMessages,
    messageIntakes,
    deliveryLines,
    deliveryRecords,
    dispatchLines,
    dispatchRecords,
    approvalEvents,
    approvalRequests,
    notifications,
    quotationEvents,
    quotationLines,
    quotations,
    extractedOrderLines,
    extractionRuns,
    productVerifications,
    priceDecisions,
    orderApprovals,
    orderStatusHistories,
    orderDocuments,
    orderHandovers,
    customerDecisionEvents,
    lostSaleRecords,
    unfulfilledDemands,
    pickingLines,
    pickingSessions,
    claimReturns,
    invoiceClaimAttachments,
    claimResolutions,
    creditNotes,
    invoiceClaimLines,
    invoiceClaims,
    invoiceDeliveryRecords,
    sapInvoiceLines,
    sapInvoices,
    sapInvoiceImportBatches,
    creditNoteImportBatches,
    integrationOperations,
    integrationSyncJobs,
    productAliases,
    customerAliases,
    orderLines,
    customerOrders,
    stockSnapshotLines,
    stockSnapshots,
  };
}

function printCounts(counts: Record<string, number>): void {
  const width = Math.max(...Object.keys(counts).map((k) => k.length));
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(width)} : ${value}`);
  }
  console.log(`  ${"TOTAL".padEnd(width)} : ${totalOfCounts(counts)}`);
}

async function main() {
  const args: ParsedResetArgs = parseResetArgs(process.argv.slice(2));
  printTargetDatabase();

  if (!args.actor) {
    printUsageAndExit("--actor=<admin-user-id> is required (even for --dry-run).");
  }
  const actorUser = await validateAdminActor(args.actor);
  console.log(`Actor verified: ${actorUser.name} <${actorUser.email}> (ADMINISTRATOR, ACTIVE)\n`);

  if (args.dryRun) {
    console.log("DRY RUN -- counting operational rows, changing nothing.\n");
    const counts = await countOperationalRows();
    printCounts(counts);
    console.log(
      `\nTo execute the reset for real, re-run with --backup-reference, --confirm, and\n` +
        `--confirm-total-rows=${totalOfCounts(counts)} (the TOTAL just printed above). See\n` +
        "DATABASE-CLEANUP-PLAN.md before doing so."
    );
    return;
  }

  // --- Real-run argument validation --------------------------------------
  // The pure gates (non-empty backup reference, exact confirm phrase, a
  // well-formed --confirm-total-rows, and that it matches a FRESH recount
  // rather than any cached number) live in lib/db-reset-args.ts so they
  // have unit coverage without needing a database. Only the fresh count
  // itself requires the database, so it is taken here and handed in.
  console.log("Re-counting operational rows at run time (not reusing any earlier dry-run number)...");
  const freshCounts = await countOperationalRows();
  const freshTotal = totalOfCounts(freshCounts);
  const guard = checkRealRunGuards(args, freshTotal);
  if (!guard.ok) {
    printUsageAndExit(guard.message);
  }
  console.log(`Confirmed: current total (${freshTotal}) matches --confirm-total-rows.\n`);

  console.log("Proceeding with the operational data reset. This cannot be undone from within the application.\n");

  const result = await prisma.$transaction(
    async (tx) => {
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
      // preserved (config, not a transaction) -- ApprovalRequest.policyId
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
      // preserved config and is never touched here.
      const integrationOperations = await tx.integrationOperation.deleteMany({});
      const integrationSyncJobs = await tx.integrationSyncJob.deleteMany({});

      // Learned extraction aliases. Only Cascade (to preserved Customer/
      // Product) and Restrict-to-preserved-User FKs -- no ordering
      // requirement against any other group in this script. See
      // DATABASE-CLEANUP-PLAN.md section 3 for why these are classified as
      // operational (the one genuine judgment call in this plan) and how
      // to exclude them if Willsgrove decides otherwise.
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

      const counts: Record<string, number> = {
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
      };

      await tx.auditEvent.create({
        data: {
          actorId: actorUser.id,
          action: "OPERATIONAL_DATA_RESET",
          entityType: "System",
          entityId: "operational-data-reset",
          afterData: {
            actorEmail: actorUser.email,
            backupReference: args.backupReference,
            counts,
          },
        },
      });

      return counts;
    },
    {
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_MAX_WAIT_MS,
    }
  );

  console.log("Operational data reset complete. Rows deleted:\n");
  printCounts(result);
  console.log(
    "\nAn AuditEvent (action: OPERATIONAL_DATA_RESET) recording this run, its actor, and the backup " +
      "reference above has been appended. Master/reference data (User, Customer, Product, TaxCode, " +
      "PriceList/PriceListEntry, Personnel, Vehicle), ApprovalPolicy, IntegrationConnection, Session, " +
      "and AuditEvent itself were not touched."
  );
}

main()
  .catch((error) => {
    console.error("Operational data reset failed -- no changes were committed (transactional):", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
