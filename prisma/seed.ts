/**
 * Milestone 0 seed script.
 *
 * Run with: npm run db:seed  (see SETUP-WINDOWS.md for the Windows
 * walkthrough, including how Prisma invokes this automatically after
 * `prisma migrate dev`).
 *
 * What this creates:
 *  - Exactly ONE real row anywhere: the administrator account, from
 *    SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (required env vars -- this
 *    script refuses to run without them, and never falls back to a
 *    hardcoded default password). mustChangePassword is set true, so the
 *    temporary password from .env.local must be changed at first login.
 *  - Demo customers (isDemo: true) and demo orders (isDemo: true)
 *    referencing them, built by calling the SAME lib/customers.ts /
 *    lib/orders.ts functions the real API routes use (not raw
 *    prisma.create() calls) -- so seeding also exercises the real
 *    validation, audit-logging and idempotency paths.
 *  - No demo Product rows, as of this fix round. Willsgrove's real SAP
 *    item catalogue is imported through Products -> Import (see
 *    lib/product-import.ts); this script never creates placeholder
 *    products, and demo orders reference REAL, already-imported products
 *    (isDemo: false) by looking a handful of them up -- see
 *    pickRealProductsForDemoOrders() below. If the catalogue hasn't been
 *    imported yet, demo orders are skipped (with a clear console message
 *    explaining why) rather than inventing fake SAP codes or failing the
 *    whole seed run -- the admin account and demo customers still seed
 *    successfully either way. Re-run `npm run db:seed` after importing
 *    the catalogue to add the demo orders retroactively; it's idempotent
 *    either way.
 *  - No demo User rows. CustomerOrder.createdById is a required,
 *    Restrict-on-delete foreign key to User, and Settings > Users & Roles
 *    is explicitly real at this milestone -- seeding a second "demo"
 *    account into that real, admin-managed list would be confusing and
 *    arguably unsafe (an extra login-capable account nobody asked for).
 *    Demo orders are recorded as created by the seeded admin instead,
 *    which is accurate: the admin (or whoever runs this script as them)
 *    is who actually produced them.
 *
 * Idempotent: safe to re-run. The admin is upserted by email. Demo rows
 * are looked up by a stable natural key (sapCustomerCode / idempotencyKey)
 * and skipped if they already exist, so re-running this script never
 * creates duplicates.
 */
import "dotenv/config";
import { OrderSource, OrderStatus, RecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, checkPasswordStrength } from "@/lib/auth/password";
import { createCustomer } from "@/lib/customers";
import { createOrder } from "@/lib/orders";

async function seedAdmin(): Promise<{ id: string }> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in your environment before seeding " +
        "(see .env.example). Nothing was seeded."
    );
  }

  const strength = checkPasswordStrength(password);
  if (!strength.ok) {
    throw new Error(`SEED_ADMIN_PASSWORD is too weak: ${strength.message}`);
  }

  const passwordHash = await hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { email },
    // Re-running the seed never silently rotates an existing admin's
    // password or re-forces a password change -- only the first run sets
    // these. Someone who already changed their password keeps it.
    create: {
      name: "Willsgrove Administrator",
      email,
      passwordHash,
      role: "ADMINISTRATOR",
      status: "ACTIVE",
      mustChangePassword: true,
      isDemo: false,
    },
    update: {},
    select: { id: true },
  });

  console.log(`Admin account ready: ${email} (id ${admin.id})`);
  return admin;
}

type RealProductRef = {
  id: string;
  sapItemCode: string;
  itemName: string;
};

// Demo orders need SOMETHING to reference, but per the explicit
// instruction they must use real, already-imported SAP products rather
// than invented ones -- this looks a handful up rather than creating
// anything. Picked deterministically (ordered by sapItemCode) rather than
// randomly, so re-running the seed against an unchanged catalogue keeps
// referencing the same products and stays idempotent in spirit even
// though the demo orders themselves are keyed by idempotencyKey, not by
// which products they happen to reference.
const MIN_REAL_PRODUCTS_FOR_DEMO_ORDERS = 3;
const REAL_PRODUCTS_TO_FETCH = 6;

async function pickRealProductsForDemoOrders(): Promise<RealProductRef[]> {
  return prisma.product.findMany({
    where: { isDemo: false, status: RecordStatus.ACTIVE },
    orderBy: [{ sapItemCode: "asc" }],
    take: REAL_PRODUCTS_TO_FETCH,
    select: { id: true, sapItemCode: true, itemName: true },
  });
}

type DemoCustomerSeed = {
  sapCustomerCode: string;
  name: string;
  city: string;
  addressLine1: string;
};

// "Fictional, demo-flagged seed data with several TM Supermarkets stores"
const DEMO_CUSTOMERS: DemoCustomerSeed[] = [
  { sapCustomerCode: "DEMO-CUST-001", name: "TM Supermarket Borrowdale (Demo)", city: "Harare", addressLine1: "Borrowdale Village Shopping Centre" },
  { sapCustomerCode: "DEMO-CUST-002", name: "TM Supermarket Avondale (Demo)", city: "Harare", addressLine1: "King George Road, Avondale" },
  { sapCustomerCode: "DEMO-CUST-003", name: "TM Supermarket Mutare (Demo)", city: "Mutare", addressLine1: "Herbert Chitepo Street" },
  { sapCustomerCode: "DEMO-CUST-004", name: "TM Supermarket Bulawayo (Demo)", city: "Bulawayo", addressLine1: "Josiah Tongogara Street" },
];

async function seedCustomers(): Promise<string[]> {
  const ids: string[] = [];

  for (const customer of DEMO_CUSTOMERS) {
    const existing = await prisma.customer.findUnique({
      where: { sapCustomerCode: customer.sapCustomerCode },
      select: { id: true },
    });

    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const result = await createCustomer(
      {
        name: customer.name,
        sapCustomerCode: customer.sapCustomerCode,
        email: null,
        phone: null,
        category: "Supermarket",
        notes: "Demonstration record created by prisma/seed.ts. Not a real customer.",
        location: {
          label: "Main Store",
          addressLine1: customer.addressLine1,
          addressLine2: null,
          city: customer.city,
          province: null,
        },
      },
      { isDemo: true }
    );

    if (!result.ok) {
      throw new Error(`Failed to seed demo customer ${customer.name}: ${result.message}`);
    }

    ids.push(result.id);
  }

  console.log(`Demo customers ready: ${DEMO_CUSTOMERS.length}`);
  return ids;
}

/**
 * Advances a freshly-created demo order past its initial RECEIVED status,
 * for seed data that's more useful to look at (lib/orders.ts createOrder()
 * deliberately always starts an order at RECEIVED -- see its comments on
 * why it never auto-computes approved status/pricing). This is seed-only
 * flavor, not a general status-transition capability -- the real
 * verification/approval workflow that would set these in production is a
 * later milestone.
 */
async function advanceDemoOrder(
  orderId: string,
  adminId: string,
  toStatus: OrderStatus,
  timingField: "reviewedAt" | "approvedAt" | "invoicedAt"
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.customerOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });

    await tx.customerOrder.update({
      where: { id: orderId },
      data: { status: toStatus, [timingField]: new Date() },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        changedById: adminId,
        fromStatus: current.status,
        toStatus,
        notes: "Demo data: advanced by prisma/seed.ts for illustrative purposes.",
      },
    });
  });
}

async function seedOrders(adminId: string, customerIds: string[], realProducts: RealProductRef[]): Promise<void> {
  // Cycle through whatever real products were found (modulo), rather than
  // indexing directly -- keeps this working even on a catalogue with
  // fewer than REAL_PRODUCTS_TO_FETCH active products, as long as the
  // MIN_REAL_PRODUCTS_FOR_DEMO_ORDERS threshold in main() was met.
  const product = (index: number): RealProductRef => realProducts[index % realProducts.length];

  const demoOrders = [
    {
      idempotencyKey: "seed-demo-order-1",
      customerId: customerIds[0],
      source: OrderSource.EMAIL,
      customerPoReference: "PO-DEMO-1001",
      lines: [
        { product: product(0), qty: "40", unit: "EA", price: "2.70" },
        { product: product(1), qty: "25", unit: "KG", price: "1.10" },
      ],
      advanceTo: null,
    },
    {
      idempotencyKey: "seed-demo-order-2",
      customerId: customerIds[1],
      source: OrderSource.WHATSAPP,
      customerPoReference: "PO-DEMO-1002",
      lines: [
        { product: product(2), qty: "30", unit: "EA", price: "1.85" },
        { product: product(3), qty: "60", unit: "KG", price: "0.95" },
        { product: product(4), qty: "20", unit: "KG", price: "0.80" },
      ],
      advanceTo: { status: OrderStatus.PENDING_VERIFICATION, field: "reviewedAt" as const },
    },
    {
      idempotencyKey: "seed-demo-order-3",
      customerId: customerIds[2],
      source: OrderSource.MANUAL,
      customerPoReference: "PO-DEMO-1003",
      lines: [
        { product: product(5), qty: "15", unit: "EA", price: "3.10" },
        { product: product(0), qty: "18", unit: "EA", price: "2.65" },
      ],
      advanceTo: { status: OrderStatus.PENDING_VERIFICATION, field: "reviewedAt" as const },
    },
    {
      idempotencyKey: "seed-demo-order-4",
      customerId: customerIds[3],
      source: OrderSource.EMAIL,
      customerPoReference: "PO-DEMO-1004",
      lines: [
        { product: product(1), qty: "50", unit: "KG", price: "1.05" },
        { product: product(2), qty: "22", unit: "EA", price: "1.80" },
      ],
      advanceTo: { status: OrderStatus.APPROVED, field: "approvedAt" as const },
    },
    {
      idempotencyKey: "seed-demo-order-5",
      customerId: customerIds[0],
      source: OrderSource.WHATSAPP,
      customerPoReference: "PO-DEMO-1005",
      lines: [{ product: product(3), qty: "35", unit: "KG", price: "0.90" }],
      advanceTo: null,
    },
    {
      idempotencyKey: "seed-demo-order-6",
      customerId: customerIds[1],
      source: OrderSource.MANUAL,
      customerPoReference: "PO-DEMO-1006",
      lines: [
        { product: product(4), qty: "28", unit: "KG", price: "0.82" },
        { product: product(5), qty: "12", unit: "EA", price: "3.00" },
      ],
      advanceTo: null,
    },
  ];

  let created = 0;

  for (const order of demoOrders) {
    const existing = await prisma.customerOrder.findUnique({
      where: { idempotencyKey: order.idempotencyKey },
      select: { id: true },
    });

    if (existing) continue;

    const result = await createOrder(
      {
        customerId: order.customerId,
        customerLocationId: null,
        customerPoReference: order.customerPoReference,
        source: order.source,
        orderDate: null,
        requestedDeliveryDate: null,
        deliveryAddress: null,
        currency: "USD",
        internalNotes: "Demonstration record created by prisma/seed.ts. Not a real order.",
        idempotencyKey: order.idempotencyKey,
        lines: order.lines.map((line) => ({
          // The product's own real name, not a placeholder -- these lines
          // reference an actually-imported SAP item, see
          // pickRealProductsForDemoOrders() above.
          originalProductDescription: line.product.itemName,
          productId: line.product.id,
          sapItemCodeSnapshot: line.product.sapItemCode,
          requestedQuantity: line.qty,
          requestedUnitCode: line.unit,
          customerUnitPrice: line.price,
          salesNotes: null,
        })),
      },
      adminId,
      { isDemo: true }
    );

    if (!result.ok) {
      throw new Error(`Failed to seed demo order ${order.idempotencyKey}: ${result.message}`);
    }

    if (order.advanceTo) {
      await advanceDemoOrder(result.id, adminId, order.advanceTo.status, order.advanceTo.field);
    }

    created++;
  }

  console.log(`Demo orders ready: ${demoOrders.length} (${created} newly created, ${demoOrders.length - created} already present)`);
}

async function main() {
  console.log("Seeding Willsgrove SalesFlow (Milestone 0)...");

  const admin = await seedAdmin();
  const customerIds = await seedCustomers();

  const realProducts = await pickRealProductsForDemoOrders();
  if (realProducts.length < MIN_REAL_PRODUCTS_FOR_DEMO_ORDERS) {
    console.log(
      `Demo orders skipped: only found ${realProducts.length} real, active SAP product(s) ` +
        `(need at least ${MIN_REAL_PRODUCTS_FOR_DEMO_ORDERS}). Import the SAP catalogue via ` +
        "Products -> Import in the browser, then re-run `npm run db:seed` to add demo orders " +
        "referencing it. The admin account and demo customers above were still seeded normally."
    );
  } else {
    await seedOrders(admin.id, customerIds, realProducts);
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
