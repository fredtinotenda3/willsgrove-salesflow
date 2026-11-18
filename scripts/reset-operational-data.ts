/**
 * Operational data reset — a different, broader tool than
 * `scripts/remove-demo-data.ts` (`npm run db:remove-demo`), and a narrower
 * one than `scripts/reset-to-user-and-product.ts`
 * (`npm run db:reset-to-user-and-product`).
 *
 * `remove-demo-data.ts` deletes only rows flagged `isDemo: true` and never
 * touches master data. THIS script deletes every row -- demo and real alike
 * -- from every operational/transactional table, while leaving master data
 * (User, Customer, Product, TaxCode, PriceList/PriceListEntry, Personnel,
 * Vehicle), two configuration singletons (ApprovalPolicy, IntegrationConnection),
 * Session, and AuditEvent completely untouched.
 * `reset-to-user-and-product.ts` goes further still -- it keeps only User
 * and Product, wiping Customer/Personnel/Vehicle/TaxCode/PriceList/Session
 * too -- for a genuine "start clean with only real Products and logins"
 * reset ahead of a fresh customer-master-import.
 *
 * The actual delete logic (what gets wiped, and the FK-order reasoning for
 * why) lives in `lib/db-reset-operations.ts`'s `deleteOperationalData()` --
 * extracted there so `reset-to-user-and-product.ts` can reuse it as its own
 * first phase instead of duplicating it. This script only orchestrates:
 * argument parsing/gating (`lib/db-reset-args.ts`), the admin-actor check,
 * counting, and the transaction wrapper.
 *
 * This script must never be run against any real or seeded database
 * without a human first reading this file and `lib/db-reset-operations.ts`
 * in full, confirming a real backup exists, and explicitly deciding to
 * proceed. Never wire this into any automated path (deploy, migration,
 * seed, startup, cron) -- it exists to be run once, deliberately, by a
 * human at a terminal with real database access.
 *
 * Safety mechanisms:
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
 * See `lib/db-reset-operations.ts`'s `deleteOperationalData()` doc comment
 * for the full per-group FK-order reasoning behind the deletion order.
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
import { deleteOperationalData } from "@/lib/db-reset-operations";

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
      // The full, carefully-FK-ordered delete group now lives in
      // lib/db-reset-operations.ts (shared with
      // scripts/reset-to-user-and-product.ts) -- same 47 deletes, same
      // order, same comments, moved verbatim. See that module for the
      // full per-group FK reasoning.
      const counts = await deleteOperationalData(tx);

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
