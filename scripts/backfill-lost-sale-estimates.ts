/**
 * One-time backfill: resolve estimatedUnitPrice/estimatedValue for
 * UnfulfilledDemand (and its linked LostSaleRecord) rows that were
 * created with no estimate, now that customers have real PriceList
 * assignments.
 *
 * Run with: npm run db:backfill-lost-sale-estimates            (dry run, default)
 *           npm run db:backfill-lost-sale-estimates -- --apply  (writes)
 *
 * Context: lib/lost-sales/create-unfulfilled-demand.ts resolves and
 * freezes estimatedUnitPrice/estimatedValue ONCE, at the moment a
 * shortage is confirmed (lib/lost-sales/estimate-value.ts's
 * resolveEstimatedLostSaleValue -- OrderLine.approvedUnitPrice first,
 * then the customer's assigned PriceList). It is never recomputed later
 * -- by design, so a value already resolved never silently drifts if a
 * price list changes afterwards.
 *
 * That design has a real consequence for this business: almost every
 * customer had NO priceListId at all until the "Customer Pricing" bulk-
 * assignment round (business-data/reviewed-price-list-assignments.csv,
 * applied via scripts/apply-reviewed-price-list-assignments.ts). Every
 * UnfulfilledDemand/LostSaleRecord created before that round therefore
 * resolved to estimatedValue: null -- correctly, per the "never invent a
 * price" rule -- and stays null forever unless something re-resolves it.
 * This is that something: a ONE-TIME catch-up, run once after customers
 * got real price lists, not a standing recompute job.
 *
 * Reuses resolveEstimatedLostSaleValue() itself -- the exact same
 * resolution the live code path uses -- rather than reimplementing any
 * pricing logic. `asOf` is each demand's own original createdAt (the
 * date the shortage actually happened), not today, so the backfill finds
 * whatever price was valid AT THAT TIME, matching what the live code
 * would have resolved had the customer's price list already been
 * assigned back then.
 *
 * Deliberately excludes SUPERSEDED demands: lib/lost-sales/
 * create-unfulfilled-demand.ts's own module comment is explicit that a
 * superseded row's quantity buckets and LostSaleRecord "are never
 * touched, deleted or recomputed" -- it is kept as history, not updated.
 *
 * Still may leave some rows at null -- correctly: a demand whose customer
 * is still unassigned (e.g. THEFRESHPLUG, left unassigned for now per
 * Stanley's own decision) or whose product has no entry on the assigned
 * list has no historically valid price even now, and this never invents
 * one. Reported back, same as the price-list script's "not found" list.
 *
 * Defaults to a dry run; pass --apply to write. Each UnfulfilledDemand is
 * updated in its own transaction (TRANSACTION_OPTIONS, same timeout
 * budget as lib/orders.ts's own transactions) rather than one transaction
 * for the whole backfill -- there is no correctness requirement that this
 * run all-or-nothing (each row's estimate is independent), and a single
 * long transaction over what could be thousands of rows risks the same
 * timeout budget other single-transaction flows in this codebase are
 * deliberately sized to avoid.
 */
import "dotenv/config";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { resolveEstimatedLostSaleValue } from "@/lib/lost-sales/estimate-value";

const AUDIT_ID_LIMIT = 500;

async function backfillOne(
  tx: PrismaTransactionClient,
  demand: {
    id: string;
    orderLineId: string;
    customerId: string;
    productId: string | null;
    sapItemCodeSnapshot: string | null;
    unavailableQuantity: { toString(): string };
    createdAt: Date;
  }
): Promise<{ resolved: boolean; source?: string }> {
  const estimate = await resolveEstimatedLostSaleValue(tx, {
    orderLineId: demand.orderLineId,
    customerId: demand.customerId,
    productId: demand.productId,
    sapItemCodeSnapshot: demand.sapItemCodeSnapshot,
    quantity: demand.unavailableQuantity.toString(),
    asOf: demand.createdAt,
  });

  if (!estimate) return { resolved: false };

  await tx.unfulfilledDemand.update({
    where: { id: demand.id },
    data: {
      estimatedUnitPrice: estimate.unitPrice,
      estimatedValue: estimate.value,
      estimatedValueSource: estimate.source,
    },
  });

  await tx.lostSaleRecord.updateMany({
    where: { unfulfilledDemandId: demand.id, estimatedValue: null },
    data: {
      estimatedUnitPrice: estimate.unitPrice,
      estimatedValue: estimate.value,
      estimatedValueSource: estimate.source,
    },
  });

  await tx.auditEvent.create({
    data: {
      actorId: null,
      action: "LOST_SALE_ESTIMATE_BACKFILLED",
      entityType: "UnfulfilledDemand",
      entityId: demand.id,
      afterData: {
        estimatedUnitPrice: estimate.unitPrice,
        estimatedValue: estimate.value,
        estimatedValueSource: estimate.source,
        asOf: demand.createdAt.toISOString(),
      },
    },
  });

  return { resolved: true, source: estimate.source };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidates = await prisma.unfulfilledDemand.findMany({
    where: { estimatedValue: null, status: { not: "SUPERSEDED" } },
    select: {
      id: true,
      orderLineId: true,
      customerId: true,
      productId: true,
      sapItemCodeSnapshot: true,
      unavailableQuantity: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `${apply ? "APPLYING" : "DRY RUN (pass --apply to write)"}: ${candidates.length} UnfulfilledDemand rows with no estimate yet\n`
  );

  if (candidates.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  let resolved = 0;
  let stillUnresolved = 0;
  const bySource = new Map<string, number>();
  const unresolvedIds: string[] = [];

  for (const demand of candidates) {
    if (!apply) {
      // Dry run: resolve against the top-level client (read-only calls),
      // never inside a transaction, since nothing will be written.
      const estimate = await resolveEstimatedLostSaleValue(prisma, {
        orderLineId: demand.orderLineId,
        customerId: demand.customerId,
        productId: demand.productId,
        sapItemCodeSnapshot: demand.sapItemCodeSnapshot,
        quantity: demand.unavailableQuantity.toString(),
        asOf: demand.createdAt,
      });
      if (estimate) {
        resolved += 1;
        bySource.set(estimate.source, (bySource.get(estimate.source) ?? 0) + 1);
      } else {
        stillUnresolved += 1;
        unresolvedIds.push(demand.id);
      }
      continue;
    }

    const result = await prisma.$transaction((tx) => backfillOne(tx, demand), TRANSACTION_OPTIONS);
    if (result.resolved) {
      resolved += 1;
      bySource.set(result.source!, (bySource.get(result.source!) ?? 0) + 1);
    } else {
      stillUnresolved += 1;
      unresolvedIds.push(demand.id);
    }
  }

  console.log(`Resolved: ${resolved}`);
  for (const [source, count] of bySource) {
    console.log(`  ${count} via ${source}`);
  }
  console.log(`Still unresolved (no historically valid price even now -- unchanged, never guessed): ${stillUnresolved}`);
  if (stillUnresolved > 0) {
    console.log(
      `  First ${Math.min(stillUnresolved, AUDIT_ID_LIMIT)} unresolved demand id(s): ${unresolvedIds
        .slice(0, AUDIT_ID_LIMIT)
        .join(", ")}`
    );
  }
  if (!apply) {
    console.log("\nNothing was written. Re-run with --apply to write these changes.");
  }
}

main()
  .catch((error) => {
    console.error("Backfilling lost-sale estimates failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
