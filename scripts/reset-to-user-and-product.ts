/**
 * Full reset to User + Product only -- the broadest of this project's
 * three reset tools:
 *   - `scripts/remove-demo-data.ts` (`npm run db:remove-demo`): deletes
 *     only rows flagged `isDemo: true`.
 *   - `scripts/reset-operational-data.ts`
 *     (`npm run db:reset-operational-data`): deletes every
 *     operational/transactional row, demo and real alike, but preserves
 *     ALL master/reference data (User, Customer, Product, TaxCode,
 *     PriceList/PriceListEntry, Personnel, Vehicle) plus two configuration
 *     singletons (ApprovalPolicy, IntegrationConnection), Session, and
 *     AuditEvent.
 *   - THIS script: deletes everything that script does, PLUS Customer (and
 *     its contacts/locations/aliases), TaxCode, PriceList/PriceListEntry,
 *     Personnel, Vehicle, ApprovalPolicy, IntegrationConnection, and
 *     Session -- leaving ONLY the User table (logins) and the Product
 *     table (the real, already-imported SAP item master) intact, plus one
 *     freshly-written AuditEvent row documenting this very reset (every
 *     prior AuditEvent row is wiped too; see below).
 *
 * Built for exactly one scenario: starting clean with real Product data
 * already imported (via /products/import, from the real SAP item export),
 * before re-importing Customer data via /customers/import
 * (customer-master-import) and the other master-data imports
 * (tax-code-import, price-list-import, item-master-import) against a
 * blank operational slate. Nothing here touches Product rows or the
 * import logic that creates them -- Product is read, never written, by
 * this script.
 *
 * WHY EVERYTHING ELSE IS WIPED, NOT JUST "OPERATIONAL" DATA: this script's
 * phase 2 (lib/db-reset-operations.ts's deleteMasterDataExceptUserAndProduct())
 * removes Customer/CustomerContact/CustomerLocation (re-imported fresh
 * right after this runs), TaxCode/PriceList/PriceListEntry (re-imported via
 * their own master-data imports), Personnel/Vehicle (re-entered manually
 * once real data is ready), ApprovalPolicy/IntegrationConnection
 * (configuration that should be re-entered deliberately for the real
 * environment, not inherited from however it was left during setup/
 * testing), Session (forces every signed-in user to log back in --
 * harmless), and AuditEvent (the old audit trail is testing/setup history,
 * not real operational history worth keeping once this reset runs -- see
 * the note on the one new AuditEvent row below).
 *
 * The actual delete logic (phase 1: lib/db-reset-operations.ts's
 * deleteOperationalData(), identical to what
 * scripts/reset-operational-data.ts runs; phase 2: that same module's
 * deleteMasterDataExceptUserAndProduct(), the new tables this script adds)
 * and the full FK-order reasoning for both phases live in
 * lib/db-reset-operations.ts -- read that module's doc comments in full
 * before running this script, not just this one.
 *
 * This script must never be run against any real or seeded database
 * without a human first reading this file and lib/db-reset-operations.ts
 * in full and explicitly deciding to proceed. Never wire this into any
 * automated path (deploy, migration, seed, startup, cron) -- it exists to
 * be run once, deliberately, by a human at a terminal with real database
 * access.
 *
 * On backups: the operator who commissioned this script stated the
 * current contents of every table it removes are test/setup data with
 * nothing in them worth preserving -- only Product (real, already
 * imported) matters, and this script never touches Product. On that
 * basis --backup-reference is NOT required here (see point 4 below),
 * unlike scripts/reset-operational-data.ts, which still requires one. If
 * that stops being true for a later run -- real Customer or order data
 * has since entered the system and this script is run again -- take a
 * real backup first regardless of what this script enforces; the gate
 * being off does not mean a backup stopped being a good idea, only that
 * it is no longer this script's job to force one.
 *
 * Safety mechanisms (identical pattern to reset-operational-data.ts, with
 * its own, deliberately different confirm phrase -- see
 * lib/db-reset-args.ts's FULL_RESET_CONFIRM_PHRASE comment for why reusing
 * the narrower script's phrase would be a mistake here):
 *   1. Admin-gated: --actor must name a real User row with role
 *      ADMINISTRATOR and status ACTIVE, validated against the database
 *      before anything else happens.
 *   2. Dry-run first: --dry-run prints full per-table counts (everything
 *      that WOULD be removed, and -- separately -- the User/Product counts
 *      that will be KEPT) and a grand total, changing nothing.
 *   3. The real run requires --confirm-total-rows=<N> to match a FRESH
 *      recount of the to-be-removed tables taken at run time (not the dry
 *      run's cached number, and never counting User/Product, which are
 *      never part of this total since they are never deleted) -- a stale
 *      or copy-pasted command from a different moment or environment is
 *      refused rather than silently deleting a different amount of data
 *      than the operator actually reviewed.
 *   4. Backup-reference is OPTIONAL here (checkRealRunGuards() is called
 *      with requireBackupReference=false), per the note above -- but if
 *      --backup-reference="<description>" is supplied anyway, it is still
 *      recorded verbatim in the terminal AuditEvent.
 *   5. Confirmation-required: --confirm must equal the exact literal
 *      phrase FULL_RESET_CONFIRM_PHRASE below -- distinct from
 *      reset-operational-data.ts's phrase on purpose.
 *   6. Transactional: both delete phases plus the terminal AuditEvent run
 *      in one prisma.$transaction -- a failure partway through leaves the
 *      database exactly as it was.
 *   7. Idempotent/guarded: every delete is an unconditional deleteMany({})
 *      on its table; running this again against an already-empty dataset
 *      is a safe no-op (the AuditEvent write is the only row it ever adds).
 *
 * Why a fresh AuditEvent row is written even though AuditEvent is wiped:
 * deleteMasterDataExceptUserAndProduct() deletes every existing AuditEvent
 * row, but losing a record of WHO ran this reset and WHEN would be a real
 * accountability gap for a destructive, irreversible action -- the same
 * reasoning reset-operational-data.ts already applies to its own
 * (narrower) reset. So this script writes exactly one new AuditEvent row,
 * immediately after both delete phases complete, inside the SAME
 * transaction -- it is therefore the only row left in the AuditEvent table
 * once this transaction commits.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  FULL_RESET_CONFIRM_PHRASE,
  checkRealRunGuards,
  parseResetArgs,
  totalOfCounts,
  type ParsedResetArgs,
} from "@/lib/db-reset-args";
import { deleteOperationalData, deleteMasterDataExceptUserAndProduct, type DeleteCounts } from "@/lib/db-reset-operations";

// Same reasoning as the other two reset scripts: this is 59 sequential
// round trips over one connection to a pooled endpoint, well past Prisma's
// 5000ms default interactive-transaction timeout. Kept strictly
// sequential rather than Promise.all -- Prisma documents concurrent
// queries against one interactive-transaction client as unsafe, since
// they share one underlying connection not guaranteed safe for concurrent
// use. The timeout is raised instead, which is what Prisma's own docs
// recommend for a transaction that is simply slower than the default
// allows. Set higher than reset-operational-data.ts's own 120s, since
// this script does strictly more work in one transaction.
const TRANSACTION_TIMEOUT_MS = 180_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

function printUsageAndExit(message: string): never {
  console.error(`ERROR: ${message}\n`);
  console.error("Usage:");
  console.error("  Dry run (no changes):");
  console.error("    npm run db:reset-to-user-and-product -- --actor=<admin-user-id> --dry-run\n");
  console.error("  Real run (after reviewing the dry run's output):");
  console.error("    npm run db:reset-to-user-and-product -- \\");
  console.error("      --actor=<admin-user-id> \\");
  console.error(`      --confirm="${FULL_RESET_CONFIRM_PHRASE}" \\`);
  console.error("      --confirm-total-rows=<N, from the dry run's grand total>\n");
  console.error(
    '  --backup-reference="<description>" is optional for this script (see the module\n' +
      "  comment for why) -- pass it if you do want one recorded in the audit log.\n",
  );
  console.error(
    "Read scripts/reset-to-user-and-product.ts and lib/db-reset-operations.ts in full before running this for real.",
  );
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

// Counts every table that will be REMOVED by this script -- phase 1
// (operational, same set reset-operational-data.ts counts) plus phase 2
// (the additional master/config/session/audit tables this script alone
// wipes). Used for both --dry-run and the fresh recount --confirm-total-
// rows is checked against.
async function countRemovedRows(): Promise<DeleteCounts> {
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
    customerContacts,
    customerLocations,
    customers,
    priceListEntries,
    priceLists,
    taxCodes,
    personnel,
    vehicles,
    approvalPolicies,
    integrationConnections,
    sessions,
    auditEvents,
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
    prisma.customerContact.count(),
    prisma.customerLocation.count(),
    prisma.customer.count(),
    prisma.priceListEntry.count(),
    prisma.priceList.count(),
    prisma.taxCode.count(),
    prisma.personnel.count(),
    prisma.vehicle.count(),
    prisma.approvalPolicy.count(),
    prisma.integrationConnection.count(),
    prisma.session.count(),
    prisma.auditEvent.count(),
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
    customerContacts,
    customerLocations,
    customers,
    priceListEntries,
    priceLists,
    taxCodes,
    personnel,
    vehicles,
    approvalPolicies,
    integrationConnections,
    sessions,
    auditEvents,
  };
}

// The two tables this script NEVER deletes from, counted separately and
// printed alongside every dry-run/real-run so "what stays" is always as
// visible as "what goes" -- never just implied by omission.
async function countKeptRows(): Promise<{ users: number; products: number }> {
  const [users, products] = await Promise.all([prisma.user.count(), prisma.product.count()]);
  return { users, products };
}

function printCounts(counts: Record<string, number>): void {
  const width = Math.max(...Object.keys(counts).map((k) => k.length));
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(width)} : ${value}`);
  }
  console.log(`  ${"TOTAL".padEnd(width)} : ${totalOfCounts(counts)}`);
}

async function printKeptSummary(): Promise<void> {
  const kept = await countKeptRows();
  console.log("KEPT (never touched by this script):");
  console.log(`  User    : ${kept.users} row(s)`);
  console.log(`  Product : ${kept.products} row(s)`);
  console.log("");
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
    console.log("DRY RUN -- counting rows, changing nothing.\n");
    await printKeptSummary();
    console.log("REMOVED (every row in every table below):");
    const counts = await countRemovedRows();
    printCounts(counts);
    console.log(
      `\nTo execute the reset for real, re-run with --confirm and\n` +
        `--confirm-total-rows=${totalOfCounts(counts)} (the TOTAL just printed above). Read\n` +
        "scripts/reset-to-user-and-product.ts and lib/db-reset-operations.ts in full before doing so.",
    );
    return;
  }

  // --- Real-run argument validation --------------------------------------
  await printKeptSummary();
  console.log("Re-counting rows to be removed at run time (not reusing any earlier dry-run number)...");
  const freshCounts = await countRemovedRows();
  const freshTotal = totalOfCounts(freshCounts);
  const guard = checkRealRunGuards(args, freshTotal, FULL_RESET_CONFIRM_PHRASE, /* requireBackupReference */ false);
  if (!guard.ok) {
    printUsageAndExit(guard.message);
  }
  console.log(`Confirmed: current total (${freshTotal}) matches --confirm-total-rows.\n`);

  console.log(
    "Proceeding with the full reset to User + Product only. This cannot be undone from within the application.\n",
  );

  const result = await prisma.$transaction(
    async (tx) => {
      const operationalCounts = await deleteOperationalData(tx);
      const masterCounts = await deleteMasterDataExceptUserAndProduct(tx);
      const counts: DeleteCounts = { ...operationalCounts, ...masterCounts };

      // The ONE row left in AuditEvent once this commits -- see this
      // file's own module comment for why this is written even though
      // deleteMasterDataExceptUserAndProduct() just wiped every prior
      // AuditEvent row.
      await tx.auditEvent.create({
        data: {
          actorId: actorUser.id,
          action: "FULL_RESET_TO_USER_AND_PRODUCT",
          entityType: "System",
          entityId: "full-reset-to-user-and-product",
          afterData: {
            actorEmail: actorUser.email,
            // backup-reference is optional for this script (see module
            // comment) -- record what was actually given, including the
            // explicit "none" case, rather than writing a misleading blank.
            backupReference: args.backupReference ?? "(none provided -- not required for this reset)",
            counts,
          },
        },
      });

      return counts;
    },
    {
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_MAX_WAIT_MS,
    },
  );

  console.log("Full reset complete. Rows deleted:\n");
  printCounts(result);
  const keptAfter = await countKeptRows();
  console.log(
    `\nUser (${keptAfter.users} row(s)) and Product (${keptAfter.products} row(s)) were not touched. ` +
      "A single new AuditEvent row (action: FULL_RESET_TO_USER_AND_PRODUCT) recording this run, its actor, " +
      "and the backup-reference value above (if any) is now the only row in the AuditEvent table.\n" +
      "Next step: re-import Customer data (and any other master data you need -- tax codes, price lists) " +
      "through the application's own import flows.",
  );
}

main()
  .catch((error) => {
    console.error("Full reset failed -- no changes were committed (transactional):", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
