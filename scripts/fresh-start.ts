/**
 * Fresh start: wipe EVERY record except user accounts, then load a
 * complete, realistic showcase dataset so each screen can be reviewed.
 *
 *   npm run db:fresh-start              dry run -- shows the target database and what would be removed
 *   npm run db:fresh-start -- --yes     wipes and seeds (after a 10-second chance to abort with Ctrl+C)
 *
 * WIPED: every operational and master row -- orders, picking, dispatch,
 * delivery, invoices, claims, returns, lost sales, quotations, approvals,
 * communications, customers, products, price lists, tax codes, personnel,
 * vehicles, configuration singletons, sessions and the audit log.
 * KEPT: User accounts (so you can still log in).
 *
 * SEEDED (all real rows, isDemo = false, so every report and chart shows
 * them): tax codes, 20 products, 2 price lists with entries, 6 customers
 * with price lists assigned, drivers/assistants/vehicles, and 18 orders
 * taken through the real lifecycle by the application's own functions
 * (picking, authorization, dispatch, delivery with rejection reasons,
 * native invoices) so lost sales and the Invoice Claims page have data.
 *
 * The wipe reuses lib/db-reset-operations.ts (the project's reviewed,
 * FK-ordered delete groups) inside ONE transaction: if it fails, nothing
 * is removed. Seeding afterwards is per-record and reports any scenario
 * that could not be completed instead of aborting the rest.
 *
 * Never wire this into deploy/migration/startup. Run it deliberately,
 * against a database you are happy to empty.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { deleteOperationalData, deleteMasterDataExceptUserAndProduct, type DeleteCounts } from "@/lib/db-reset-operations";
import { createCustomer } from "@/lib/customers";
import { createOrder } from "@/lib/orders";
import { startPickingSession } from "@/lib/picking/start-picking";
import { completePickingSession } from "@/lib/picking/complete-picking";
import { authorizePickingSession } from "@/lib/picking/authorize-picking";
import { createDispatchRecord, departDispatchRecord } from "@/lib/fulfilment/dispatch";
import { recordDelivery } from "@/lib/fulfilment/delivery";
import { recordNativeInvoice } from "@/lib/invoice-recording/record-native-invoice";
import { CLAIM_LINE_REASON_CATEGORY_LABELS } from "@/lib/invoice-claims/validation";
import { CUSTOMERS, PERSONNEL, PRICE_LISTS, PRODUCTS, SCENARIOS, TAX_CODES, VEHICLES, type OrderScenario } from "../prisma/fresh-start/data";

const TRANSACTION_TIMEOUT_MS = 180_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;
const ABORT_WINDOW_SECONDS = 10;

function dateOnly(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function describeDatabase(): { host: string; name: string } {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return { host: url.host, name: url.pathname.replace(/^\//, "") };
  } catch {
    return { host: "(unparseable DATABASE_URL)", name: "(unknown)" };
  }
}

async function countKeyTables(): Promise<Record<string, number>> {
  const [users, products, customers, orders, invoices, claims, demands, auditEvents] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.customer.count(),
    prisma.customerOrder.count(),
    prisma.sapInvoice.count(),
    prisma.invoiceClaim.count(),
    prisma.unfulfilledDemand.count(),
    prisma.auditEvent.count(),
  ]);
  return { users, products, customers, orders, invoices, claims, unfulfilledDemands: demands, auditEvents };
}

async function wipeEverythingExceptUsers(): Promise<number> {
  const counts = await prisma.$transaction(
    async (tx) => {
      const operational = await deleteOperationalData(tx);
      const master = await deleteMasterDataExceptUserAndProduct(tx);
      // Product is the last master table: everything that references it
      // (order lines, aliases, price list entries, stock lines, demands,
      // quotation lines, recommendations) was removed above.
      const products = await tx.product.deleteMany({});
      const merged: DeleteCounts = { ...operational, ...master, products: products.count };
      return merged;
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

type Ids = {
  adminId: string;
  customerByCode: Map<string, string>;
  productByCode: Map<string, { id: string; itemName: string; unitOfMeasure: string }>;
  priceByList: Map<string, Map<string, string>>; // price list code -> product code -> unit price
  customerPriceList: Map<string, string>; // customer code -> price list code
  driverIds: string[];
  assistantIds: string[];
  vehicleIds: string[];
};

async function seedMasterData(adminId: string): Promise<Ids> {
  for (const tax of TAX_CODES) {
    await prisma.taxCode.create({ data: { code: tax.code, description: tax.description, ratePercent: tax.ratePercent } });
  }

  const productByCode: Ids["productByCode"] = new Map();
  for (const p of PRODUCTS) {
    const row = await prisma.product.create({
      data: {
        sapItemCode: p.sapItemCode,
        itemName: p.itemName,
        barcode: p.barcode,
        category: p.category,
        unitOfMeasure: p.unitOfMeasure,
        packSize: p.packSize,
        vatCode: p.vatCode,
        importedAt: new Date(),
      },
      select: { id: true },
    });
    productByCode.set(p.sapItemCode, { id: row.id, itemName: p.itemName, unitOfMeasure: p.unitOfMeasure });
  }

  const priceByList: Ids["priceByList"] = new Map();
  const priceListIdByCode = new Map<string, string>();
  const validFrom = new Date("2026-01-01T00:00:00.000Z");
  for (const list of PRICE_LISTS) {
    const created = await prisma.priceList.create({ data: { code: list.code, name: list.name, currencyCode: list.currencyCode }, select: { id: true } });
    priceListIdByCode.set(list.code, created.id);
    const prices = new Map<string, string>();
    for (const p of PRODUCTS) {
      const unitPrice = p[list.key];
      prices.set(p.sapItemCode, unitPrice);
      await prisma.priceListEntry.create({
        data: { priceListId: created.id, productId: productByCode.get(p.sapItemCode)!.id, sapItemCodeSnapshot: p.sapItemCode, unitPrice, validFrom },
      });
    }
    priceByList.set(list.code, prices);
  }

  const customerByCode = new Map<string, string>();
  const customerPriceList = new Map<string, string>();
  for (const c of CUSTOMERS) {
    const result = await createCustomer({
      name: c.name,
      sapCustomerCode: c.sapCustomerCode,
      email: c.email,
      phone: c.phone,
      category: c.category,
      notes: null,
      location: { label: "Main Store", addressLine1: c.addressLine1, addressLine2: null, city: c.city, province: null },
    });
    if (!result.ok) throw new Error(`Customer ${c.name}: ${result.message}`);
    await prisma.customer.update({ where: { id: result.id }, data: { priceListId: priceListIdByCode.get(c.priceList)! } });
    customerByCode.set(c.sapCustomerCode, result.id);
    customerPriceList.set(c.sapCustomerCode, c.priceList);
  }

  const driverIds: string[] = [];
  const assistantIds: string[] = [];
  for (const person of PERSONNEL) {
    const row = await prisma.personnel.create({
      data: { name: person.name, role: person.role, phone: person.phone, createdById: adminId },
      select: { id: true },
    });
    (person.role === "DRIVER" ? driverIds : assistantIds).push(row.id);
  }
  const vehicleIds: string[] = [];
  for (const vehicle of VEHICLES) {
    const row = await prisma.vehicle.create({
      data: { registrationNumber: vehicle.registrationNumber, notes: vehicle.notes, createdById: adminId },
      select: { id: true },
    });
    vehicleIds.push(row.id);
  }

  console.log(
    `Master data: ${TAX_CODES.length} tax codes, ${PRODUCTS.length} products, ${PRICE_LISTS.length} price lists, ${CUSTOMERS.length} customers, ` +
      `${PERSONNEL.length} personnel, ${VEHICLES.length} vehicles.`
  );
  return { adminId, customerByCode, productByCode, priceByList, customerPriceList, driverIds, assistantIds, vehicleIds };
}

async function advanceStatus(orderId: string, adminId: string, toStatus: "PENDING_VERIFICATION" | "APPROVED"): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.customerOrder.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    await tx.customerOrder.update({
      where: { id: orderId },
      data: toStatus === "APPROVED" ? { status: toStatus, approvedAt: new Date() } : { status: toStatus, reviewedAt: new Date() },
    });
    await tx.orderStatusHistory.create({
      data: { orderId, changedById: adminId, fromStatus: current.status, toStatus, notes: "Fresh-start showcase data." },
    });
  });
}

function must<T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> {
  if (!result.ok) {
    const message = (result as unknown as { message?: string }).message ?? "unknown error";
    throw new Error(`${what}: ${message}`);
  }
  return result as Extract<T, { ok: true }>;
}

async function runScenario(scenario: OrderScenario, ids: Ids, index: number): Promise<void> {
  const customerId = ids.customerByCode.get(scenario.customer)!;
  const priceListCode = ids.customerPriceList.get(scenario.customer)!;
  const prices = ids.priceByList.get(priceListCode)!;

  const created = must(
    await createOrder(
      {
        customerId,
        customerLocationId: null,
        customerPoReference: `PO-${scenario.key}-${String(2600 + index)}`,
        source: scenario.source,
        orderDate: dateOnly(scenario.daysAgo),
        requestedDeliveryDate: dateOnly(Math.max(scenario.daysAgo - 1, 0)),
        deliveryAddress: null,
        currency: "USD",
        internalNotes: "Fresh-start showcase order.",
        idempotencyKey: `fresh-start-${scenario.key}`,
        salespersonId: ids.adminId,
        lines: scenario.lines.map((line) => {
          const product = ids.productByCode.get(line.code)!;
          return {
            originalProductDescription: product.itemName,
            productId: product.id,
            sapItemCodeSnapshot: line.code,
            requestedQuantity: line.qty,
            requestedUnitCode: product.unitOfMeasure,
            customerUnitPrice: prices.get(line.code)!,
            salesNotes: null,
          };
        }),
      },
      ids.adminId
    ),
    "create order"
  );
  const orderId = created.id;

  if (scenario.stage === "PENDING_VERIFICATION" || scenario.stage === "APPROVED") {
    await advanceStatus(orderId, ids.adminId, scenario.stage);
  }

  if (scenario.stage === "READY_TO_INVOICE" || scenario.stage === "DISPATCHED" || scenario.stage === "DELIVERED") {
    const orderLines = await prisma.orderLine.findMany({ where: { orderId }, orderBy: { lineNumber: "asc" }, select: { id: true, sapItemCodeSnapshot: true, requestedQuantity: true } });
    const lineByCode = new Map(orderLines.map((l) => [l.sapItemCodeSnapshot ?? "", l]));

    const started = must(await startPickingSession(orderId, ids.adminId), "start picking");
    const edits = scenario.lines.map((line) => {
      const orderLine = lineByCode.get(line.code)!;
      const requested = orderLine.requestedQuantity.toString();
      const found = line.found ?? requested;
      const unavailable = (Number(requested) - Number(found)).toString();
      return { orderLineId: orderLine.id, foundQuantity: found, unavailableQuantity: unavailable };
    });
    must(await completePickingSession(started.session.id, ids.adminId, edits), "complete picking");
    must(await authorizePickingSession(started.session.id, ids.adminId), "authorize picking");

    if (scenario.stage !== "READY_TO_INVOICE") {
      const dispatch = must(
        await createDispatchRecord(orderId, ids.adminId, {
          lines: edits.map((edit) => ({ orderLineId: edit.orderLineId, quantity: edit.foundQuantity })),
          driverId: ids.driverIds[index % ids.driverIds.length],
          assistantId: ids.assistantIds[index % ids.assistantIds.length],
          vehicleId: ids.vehicleIds[index % ids.vehicleIds.length],
          pickingSessionId: started.session.id,
        }),
        "create dispatch"
      );
      must(await departDispatchRecord(dispatch.dispatchRecordId, ids.adminId), "depart dispatch");

      const invoiceQuantities = new Map<string, string>(edits.map((e) => [e.orderLineId, e.foundQuantity]));

      if (scenario.stage === "DELIVERED") {
        const dispatchLines = await prisma.dispatchLine.findMany({ where: { dispatchRecordId: dispatch.dispatchRecordId }, select: { id: true, orderLineId: true, dispatchedQuantity: true } });
        const lineInputs = dispatchLines.map((dl) => {
          const code = orderLines.find((o) => o.id === dl.orderLineId)?.sapItemCodeSnapshot ?? "";
          const spec = scenario.lines.find((l) => l.code === code);
          const dispatched = dl.dispatchedQuantity.toString();
          const rejected = spec?.rejected ?? "0";
          const accepted = (Number(dispatched) - Number(rejected)).toString();
          invoiceQuantities.set(dl.orderLineId, accepted);
          return {
            dispatchLineId: dl.id,
            acceptedQuantity: accepted,
            rejectedQuantity: rejected,
            rejectionReason: spec?.reason ? CLAIM_LINE_REASON_CATEGORY_LABELS[spec.reason] : undefined,
          };
        });
        must(await recordDelivery(dispatch.dispatchRecordId, ids.adminId, { lines: lineInputs, recipientName: "Receiving clerk", notes: undefined }, {}), "record delivery");
      }

      const invoiceLines = [...invoiceQuantities.entries()]
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([orderLineId, quantityInvoiced]) => {
          const code = orderLines.find((o) => o.id === orderLineId)?.sapItemCodeSnapshot ?? "";
          return { orderLineId, quantityInvoiced, unitPrice: prices.get(code)! };
        });
      if (invoiceLines.length > 0) {
        must(await recordNativeInvoice(orderId, ids.adminId, { invoiceDate: dateOnly(Math.max(scenario.daysAgo - 1, 0)), lines: invoiceLines }), "record invoice");
      }
    }
  }

  // Spread the records over time so trend charts have a shape. Cosmetic:
  // a failure here never invalidates the order itself.
  try {
    const when = new Date(Date.now() - scenario.daysAgo * 86_400_000);
    await prisma.customerOrder.update({ where: { id: orderId }, data: { createdAt: when } });
    await prisma.unfulfilledDemand.updateMany({ where: { orderId }, data: { createdAt: when } });
    await prisma.deliveryRecord.updateMany({ where: { dispatchRecord: { orderId } }, data: { recordedAt: when } });
    await prisma.deliveryLine.updateMany({ where: { deliveryRecord: { dispatchRecord: { orderId } } }, data: { createdAt: when } });
  } catch (error) {
    console.warn(`  (could not back-date ${scenario.key}: ${error instanceof Error ? error.message : String(error)})`);
  }
}

async function main() {
  const execute = process.argv.includes("--yes");
  const target = describeDatabase();

  console.log("=== Willsgrove SalesFlow: fresh start ===");
  console.log(`Target database: ${target.name} on ${target.host}`);
  console.log("Current contents:", await countKeyTables());

  const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR", status: "ACTIVE" }, select: { id: true, email: true } });
  if (!admin) {
    throw new Error("No active ADMINISTRATOR user exists. Run `npm run db:seed` first (it creates the administrator from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD), then re-run this.");
  }
  console.log(`Seeded records will be attributed to: ${admin.email}`);

  if (!execute) {
    console.log("\nDRY RUN -- nothing was changed. Every row except User accounts would be deleted and replaced with the showcase data.");
    console.log("To proceed:  npm run db:fresh-start -- --yes");
    return;
  }

  console.log(`\nWIPING ALL DATA except user accounts in ${ABORT_WINDOW_SECONDS} seconds -- press Ctrl+C now to abort.`);
  await new Promise((resolve) => setTimeout(resolve, ABORT_WINDOW_SECONDS * 1000));

  const removed = await wipeEverythingExceptUsers();
  console.log(`Wipe complete: ${removed} rows removed (user accounts kept).`);

  const ids = await seedMasterData(admin.id);

  const failures: string[] = [];
  let index = 0;
  for (const scenario of SCENARIOS) {
    index += 1;
    try {
      await runScenario(scenario, ids, index);
      console.log(`  ✓ ${scenario.key} (${scenario.stage}, ${scenario.lines.length} lines)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${scenario.key}: ${message}`);
      console.error(`  ✗ ${scenario.key} (${scenario.stage}): ${message}`);
    }
  }

  console.log("\nAfter:", await countKeyTables());
  if (failures.length > 0) {
    console.error(`\n${failures.length} scenario(s) could not be completed (everything else was loaded):\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nDone. Start the app and review the screens.");
  }
}

main()
  .catch((error) => {
    console.error("Fresh start failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
