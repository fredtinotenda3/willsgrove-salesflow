/**
 * One-command demo-data removal.
 *
 * Run with: npm run db:remove-demo  (see SETUP-WINDOWS.md)
 *
 * Deletes every row prisma/seed.ts marked isDemo: true -- and nothing
 * else. The admin account (never isDemo) and any real data created
 * through the application are untouched.
 *
 * Deletion order matters: the schema's onDelete: Restrict foreign keys
 * (see prisma/schema.prisma) mean a child row must be deleted before its
 * parent, or Postgres rejects the delete. This walks the dependency graph
 * leaves-first: verification/pricing/approval/status-history/document
 * rows that reference a demo order's lines or the order itself, then the
 * lines, then the orders, then locations, then customers, then products.
 * All in one transaction, so a partial run can never leave the database
 * in a half-cleaned state.
 *
 * Milestone 0 fix (round 4): this is 12 sequential round trips over one
 * connection to a pooled Neon endpoint, and Prisma's *default* interactive
 * transaction timeout is 5000ms -- comfortably exceeded under real network
 * latency (confirmed: P2028 "Transaction already closed... timeout 5000ms,
 * however 5315ms passed"). The deletes stay sequential rather than being
 * parallelized with Promise.all: Prisma explicitly documents that issuing
 * concurrent queries against the *same* interactive-transaction client is
 * unsafe, since all of them share one underlying connection that isn't
 * guaranteed safe for concurrent use -- that would trade a timeout bug for
 * a harder-to-reproduce race. The timeout and maxWait below are raised
 * instead, which is the fix Prisma's own docs recommend for a transaction
 * that is simply slower than the default allows, not broken.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

// Generous on purpose: this script runs rarely (a manual, one-off cleanup
// command), never in a request path, so there's no latency budget it has
// to respect. 60s is comfortably above the slowest observed run (12 round
// trips to a cold-started pooled Postgres endpoint); 10s maxWait is how
// long to wait for a free connection from the pool before giving up, kept
// short so a genuinely stuck pool still fails fast and loud rather than
// hanging indefinitely.
const TRANSACTION_TIMEOUT_MS = 60_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

async function main() {
  console.log("Removing demo data (isDemo: true rows only)...");

  const result = await prisma.$transaction(
    async (tx) => {
      const verifications = await tx.productVerification.deleteMany({
        where: { orderLine: { isDemo: true } },
      });

      const priceDecisions = await tx.priceDecision.deleteMany({
        where: { orderLine: { isDemo: true } },
      });

      const approvals = await tx.orderApproval.deleteMany({
        where: { order: { isDemo: true } },
      });

      const statusHistory = await tx.orderStatusHistory.deleteMany({
        where: { order: { isDemo: true } },
      });

      const documents = await tx.orderDocument.deleteMany({
        where: { order: { isDemo: true } },
      });

      const orderLines = await tx.orderLine.deleteMany({
        where: { isDemo: true },
      });

      const orders = await tx.customerOrder.deleteMany({
        where: { isDemo: true },
      });

      const stockLines = await tx.stockSnapshotLine.deleteMany({
        where: { product: { isDemo: true } },
      });

      const locations = await tx.customerLocation.deleteMany({
        where: { isDemo: true },
      });

      const customers = await tx.customer.deleteMany({
        where: { isDemo: true },
      });

      const products = await tx.product.deleteMany({
        where: { isDemo: true },
      });

      // Defensive only: prisma/seed.ts does not create demo User rows (see
      // its comments on why), so this is expected to delete 0 rows. Kept
      // here so the script stays correct if that ever changes.
      await tx.session.deleteMany({ where: { user: { isDemo: true } } });
      const users = await tx.user.deleteMany({ where: { isDemo: true } });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "DEMO_DATA_REMOVED",
          entityType: "System",
          entityId: "demo-data-removal",
          afterData: {
            orders: orders.count,
            orderLines: orderLines.count,
            customers: customers.count,
            locations: locations.count,
            products: products.count,
            verifications: verifications.count,
            priceDecisions: priceDecisions.count,
            approvals: approvals.count,
            statusHistory: statusHistory.count,
            documents: documents.count,
            stockLines: stockLines.count,
            users: users.count,
          },
        },
      });

      return {
        orders: orders.count,
        orderLines: orderLines.count,
        customers: customers.count,
        locations: locations.count,
        products: products.count,
        users: users.count,
      };
    },
    {
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_MAX_WAIT_MS,
    },
  );

  console.log("Demo data removed:");
  console.log(`  Orders:           ${result.orders}`);
  console.log(`  Order lines:      ${result.orderLines}`);
  console.log(`  Customers:        ${result.customers}`);
  console.log(`  Customer locations: ${result.locations}`);
  console.log(`  Products:         ${result.products}`);
  console.log(`  Users:            ${result.users}`);
}

main()
  .catch((error) => {
    console.error("Demo data removal failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
