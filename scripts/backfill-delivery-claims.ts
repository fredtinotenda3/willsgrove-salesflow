/**
 * Creates the missing Invoice Claims for delivery outcomes that were recorded
 * BEFORE delivery rejections started producing claims automatically.
 *
 * Run (dry run, changes nothing):  npm run db:backfill-delivery-claims
 * Apply:                           npm run db:backfill-delivery-claims -- --apply
 *
 * Why it is safe to run at any time, any number of times:
 *  - Dry run is the default; nothing is written without --apply.
 *  - Idempotent: a delivery that already has a claim is skipped, and
 *    createClaimFromDelivery itself re-checks inside the transaction.
 *  - It never changes the Confirmed Loss figure: the loss is read directly from
 *    the delivery's rejected quantities whether or not a claim exists, so the
 *    backfill only fills the Invoice Claims register.
 *  - A delivery whose rejected order line already appears on an existing claim
 *    (for example one raised by hand) is SKIPPED and reported, so the register
 *    never holds two claims for the same returned goods.
 *  - Each delivery is its own transaction: one failure never blocks the rest.
 *
 * Needs no SAP connection. The claims are attributed to --actor=<userId>, or to
 * the oldest active administrator when omitted.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { createClaimFromDelivery } from "@/lib/invoice-claims/create-delivery-claim";
import { TRANSACTION_OPTIONS } from "@/lib/orders";

async function resolveActor(explicit: string | undefined): Promise<string> {
  if (explicit) {
    const user = await prisma.user.findUnique({ where: { id: explicit }, select: { id: true } });
    if (!user) throw new Error(`--actor ${explicit} is not a user.`);
    return user.id;
  }
  const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR", status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!admin) throw new Error("No active administrator found; pass --actor=<userId>.");
  return admin.id;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const actorArg = process.argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length);

  const candidates = await prisma.deliveryRecord.findMany({
    where: { invoiceClaim: null, lines: { some: { rejectedQuantity: { gt: 0 } } } },
    orderBy: { recordedAt: "asc" },
    select: {
      id: true,
      recordedAt: true,
      dispatchRecord: { select: { order: { select: { reference: true } } } },
      lines: { where: { rejectedQuantity: { gt: 0 } }, select: { dispatchLine: { select: { orderLineId: true } } } },
    },
  });

  console.log(`${candidates.length} delivery outcome(s) with rejected goods have no claim yet. Mode: ${apply ? "APPLY" : "DRY RUN (no changes)"}.`);
  const actorId = apply ? await resolveActor(actorArg) : "";
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const delivery of candidates) {
    const orderLineIds = delivery.lines.map((l) => l.dispatchLine.orderLineId);
    const alreadyClaimed = await prisma.invoiceClaimLine.count({ where: { orderLineId: { in: orderLineIds }, claim: { deliveryRecordId: null } } });
    const label = `${delivery.dispatchRecord.order.reference} (delivered ${delivery.recordedAt.toISOString().slice(0, 10)})`;
    if (alreadyClaimed > 0) {
      skipped += 1;
      console.log(`  SKIP   ${label}: an existing claim already covers ${alreadyClaimed} of these order line(s).`);
      continue;
    }
    if (!apply) {
      console.log(`  WOULD CREATE claim for ${label}: ${orderLineIds.length} line(s).`);
      continue;
    }
    try {
      const result = await prisma.$transaction((tx) => createClaimFromDelivery(tx, { deliveryRecordId: delivery.id, actorId }), TRANSACTION_OPTIONS);
      if (result.created) {
        created += 1;
        console.log(`  CREATED ${result.claimReference} for ${label}.`);
      }
    } catch (error) {
      failed += 1;
      console.error(`  FAILED ${label}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  console.log(apply ? `Done. Created ${created}, skipped ${skipped}, failed ${failed}.` : `Dry run complete. ${candidates.length - skipped} would be created, ${skipped} skipped. Re-run with --apply to create them.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
