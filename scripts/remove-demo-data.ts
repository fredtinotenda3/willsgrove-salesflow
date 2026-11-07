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
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("Removing demo data (isDemo: true rows only)...");

  const result = await prisma.$transaction(async (tx) => {
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
  });

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
