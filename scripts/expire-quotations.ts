/**
 * One-command quotation expiry sweep.
 *
 * Run with: npm run quotations:expire  (see SETUP-WINDOWS.md)
 *
 * Milestone 7 (Quotations Management), spec section 5: "a quotation
 * becomes eligible for expiry when its validity date passes... implement
 * a reliable server-side status calculation or controlled expiry
 * mechanism, not just a UI label."
 *
 * This application has no background job runner (every milestone so far
 * is a synchronous, request-driven Next.js app -- there is no existing
 * cron/queue infrastructure to hook into), so this script IS the
 * server-side mechanism: it is meant to be invoked on a real recurring
 * schedule on a real deployment (Windows Task Scheduler, cron, or any
 * equivalent), exactly the same way scripts/remove-demo-data.ts is a
 * one-command script meant to be run manually. See SETUP-WINDOWS.md for
 * the exact scheduling commands.
 *
 * All of the actual logic -- finding candidates, validating the
 * transition, writing the QuotationEvent + AuditEvent trail -- lives in
 * lib/quotations/expiry.ts's sweepExpiredQuotations(), which this script
 * does nothing but call and report on. That function already runs each
 * expiry sequentially over one connection (not Promise.all), consistent
 * with scripts/remove-demo-data.ts's own reasoning about Prisma's
 * interactive-transaction behaviour under real network latency -- there
 * is nothing left for this script to do beyond invoking it and exiting
 * with the right status code.
 *
 * Idempotent and safe to run as often as the schedule likes: a quotation
 * already EXPIRED (or in any other non-ISSUED status) is simply not a
 * candidate on the next run, and running this script with zero eligible
 * quotations does nothing and reports zero.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { sweepExpiredQuotations } from "@/lib/quotations/expiry";

async function main() {
  console.log("Sweeping for quotations past their validity date...");

  const result = await sweepExpiredQuotations();

  console.log(`Quotations expired: ${result.expiredCount}`);
  for (const quotationNumber of result.expiredQuotationNumbers) {
    console.log(`  - ${quotationNumber}`);
  }
}

main()
  .catch((error) => {
    console.error("Quotation expiry sweep failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
