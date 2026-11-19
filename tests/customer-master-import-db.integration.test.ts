import { describe, it, expect, afterAll } from "vitest";
import type { CustomerMasterRow } from "@/lib/sap-customer-master-csv";

/**
 * Real-world incident fix (see lib/customer-master-import.ts's own
 * module comment): executeCustomerMasterImport/planCustomerMasterImport
 * had NO test coverage of any kind before this file -- only the pure CSV
 * parser (tests/customer-master-import.test.ts) was tested. This gap is
 * exactly why the P2028 transaction-timeout bug (reported against the
 * real 2647-row List_of_Business_Partners.xlsx-derived CSV) was never
 * caught: nothing exercised the DB-writing half of this pipeline at any
 * scale.
 *
 * OFF BY DEFAULT, for the exact same sandbox reason as every other
 * -db.integration.test.ts file in this project: @prisma/client here is a
 * non-functional stub (next build/prisma generate are network-blocked).
 * Every lib touched below is imported with a dynamic `await import(...)`
 * inside the (skippable) test bodies, never a static top-of-file import.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user must exist --
 * not used directly by these tests, but by this project's own seed-first
 * convention for every DB-integration suite).
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

const TEST_PREFIX = `ZTEST-CMI-${Date.now()}`;

function row(overrides: Partial<CustomerMasterRow> & { customerCode: string; customerName: string }): CustomerMasterRow {
  return {
    tin: null,
    vatNumber: null,
    currencyCode: null,
    priceListCode: null,
    paymentTermsCode: null,
    branchCode: null,
    storeCode: null,
    creditLimit: null,
    creditHold: false,
    addressLine1: null,
    city: null,
    phone: null,
    email: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    sourceData: {},
    ...overrides,
  };
}

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Customer master import -- DB-backed pipeline (real-world incident fix)", () => {
  const createdCustomerIds: string[] = [];

  afterAll(async () => {
    if (createdCustomerIds.length === 0) return;
    const { prisma } = await import("@/lib/prisma");
    // FK-respecting (leaves-first) order -- CustomerLocation/CustomerContact
    // are onDelete: Restrict against Customer.
    await prisma.customerLocation.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.customerContact.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await prisma.auditEvent.deleteMany({ where: { entityType: "CustomerMasterImport", action: "CUSTOMER_MASTER_IMPORT", afterData: { path: ["fileName"], equals: `${TEST_PREFIX}.csv` } } });
    await prisma.$disconnect();
  });

  it("LEAN-shaped rows (no address/contact -- the real Business Partner list's actual shape) take the createMany fast path and are created correctly", async () => {
    const { planCustomerMasterImport, executeCustomerMasterImport } = await import("@/lib/customer-master-import");
    const { prisma } = await import("@/lib/prisma");

    const rows: CustomerMasterRow[] = [
      row({ customerCode: `${TEST_PREFIX}-A`, customerName: "Test Customer A" }),
      row({ customerCode: `${TEST_PREFIX}-B`, customerName: "Test Customer B", creditHold: true }),
    ];

    const plan = await planCustomerMasterImport(rows);
    expect(plan.newCustomers).toHaveLength(2);
    expect(plan.changedCustomers).toHaveLength(0);

    const result = await executeCustomerMasterImport(plan, `${TEST_PREFIX}.csv`);
    expect(result.partial).toBe(false);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);

    const created = await prisma.customer.findMany({
      where: { sapCustomerCode: { in: [`${TEST_PREFIX}-A`, `${TEST_PREFIX}-B`] } },
      select: { id: true, sapCustomerCode: true, name: true, creditHold: true },
    });
    createdCustomerIds.push(...created.map((c) => c.id));
    expect(created).toHaveLength(2);
    expect(created.find((c) => c.sapCustomerCode === `${TEST_PREFIX}-B`)?.creditHold).toBe(true);

    const auditEvent = await prisma.auditEvent.findUnique({ where: { id: result.auditEventId } });
    expect(auditEvent).not.toBeNull();
    expect((auditEvent?.afterData as { partial?: boolean } | null)?.partial).toBe(false);
  });

  it("is idempotent: re-planning the exact same rows after a successful import reports them as unchanged, never as new again", async () => {
    const { planCustomerMasterImport } = await import("@/lib/customer-master-import");

    const rows: CustomerMasterRow[] = [row({ customerCode: `${TEST_PREFIX}-A`, customerName: "Test Customer A" })];
    const plan = await planCustomerMasterImport(rows);

    expect(plan.newCustomers).toHaveLength(0);
    expect(plan.changedCustomers).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });

  it("a row carrying nested address/contact data (RICH-layout shape) takes the individual customer.create() path and the nested rows are written", async () => {
    const { planCustomerMasterImport, executeCustomerMasterImport } = await import("@/lib/customer-master-import");
    const { prisma } = await import("@/lib/prisma");

    const rows: CustomerMasterRow[] = [
      row({
        customerCode: `${TEST_PREFIX}-C`,
        customerName: "Test Customer C",
        addressLine1: "123 Test Street",
        city: "Harare",
        contactName: "Jane Tester",
        contactEmail: "jane@example.test",
      }),
    ];

    const plan = await planCustomerMasterImport(rows);
    const result = await executeCustomerMasterImport(plan, `${TEST_PREFIX}.csv`);
    expect(result.partial).toBe(false);
    expect(result.created).toBe(1);

    const created = await prisma.customer.findFirst({
      where: { sapCustomerCode: `${TEST_PREFIX}-C` },
      select: { id: true, locations: { select: { addressLine1: true } }, contacts: { select: { name: true } } },
    });
    expect(created).not.toBeNull();
    if (created) createdCustomerIds.push(created.id);
    expect(created?.locations[0]?.addressLine1).toBe("123 Test Street");
    expect(created?.contacts[0]?.name).toBe("Jane Tester");
  });

  it("a changed field on an already-imported customer is picked up and updated via the chunked update path", async () => {
    const { planCustomerMasterImport, executeCustomerMasterImport } = await import("@/lib/customer-master-import");
    const { prisma } = await import("@/lib/prisma");

    const changedRows: CustomerMasterRow[] = [row({ customerCode: `${TEST_PREFIX}-A`, customerName: "Test Customer A -- Renamed" })];
    const plan = await planCustomerMasterImport(changedRows);
    expect(plan.changedCustomers).toHaveLength(1);
    expect(plan.newCustomers).toHaveLength(0);

    const result = await executeCustomerMasterImport(plan, `${TEST_PREFIX}.csv`);
    expect(result.partial).toBe(false);
    expect(result.updated).toBe(1);

    const updated = await prisma.customer.findFirst({ where: { sapCustomerCode: `${TEST_PREFIX}-A` }, select: { name: true } });
    expect(updated?.name).toBe("Test Customer A -- Renamed");
  });
});
