/**
 * One-command SAP Business One scheduled sync.
 *
 * Run with: npm run sap:sync  (see SETUP-WINDOWS.md)
 *
 * Milestone 9 (SAP Business One Integration), spec section 7: "support
 * both manual and scheduled synchronisation... do not assume a
 * persistent background worker process is available." Same reasoning
 * and same "this script IS the server-side scheduling mechanism"
 * convention as scripts/expire-quotations.ts -- this application has no
 * background job runner, so this is meant to be invoked on a real
 * recurring schedule (Windows Task Scheduler or any cron equivalent),
 * never left running.
 *
 * Runs PRODUCT_IMPORT and CUSTOMER_IMPORT only, each via
 * runIntegrationSyncJob(..., "SCHEDULED", null, ...) -- see lib/
 * integrations/sap/{product,customer}-sync.ts. Does NOT run invoice or
 * credit-note sync: SapInvoiceImportBatch.uploadedById and
 * CreditNoteImportBatch.uploadedById are both required, non-nullable
 * columns (Milestone 5/6B), and a scheduled run triggered by an external
 * scheduler has no signed-in user to attribute an import batch to. This
 * is a deliberate, documented scope boundary (lib/integrations/sap/
 * invoice-sync.ts's own module comment), not an oversight -- invoice/
 * credit-note sync is manual-only, from an ADMINISTRATOR's own "Sync
 * now" click on the /integrations/sap dashboard.
 *
 * Also does NOT process the SALES_ORDER_OUTBOX here: unlike product/
 * customer sync (which only ever reads from SAP), a pending outbox
 * submission writing to SAP unattended, on a schedule, without a human
 * having triggered that specific order, is a materially different (and
 * more consequential) kind of automation than this milestone's spec
 * asks for -- order submission in this milestone is always a deliberate
 * action by whoever is looking at that order (see lib/integrations/sap/
 * order-outbox.ts's submitOrderToSap, called only from app/api/orders/
 * [id]/sap-submit/route.ts). A future milestone could add scheduled
 * outbox processing as an explicit, separately-reviewed decision; this
 * script does not take that step on its own.
 *
 * Idempotent and safe to run as often as the schedule likes -- each run
 * creates its own IntegrationSyncJob row and leaves the underlying
 * Milestone 1 import machinery's own dedupe (by SAP code) to decide
 * what, if anything, actually changed.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runProductSync } from "@/lib/integrations/sap/product-sync";
import { runCustomerSync } from "@/lib/integrations/sap/customer-sync";

async function main() {
  console.log("Running scheduled SAP product sync...");
  const productJob = await runProductSync("SCHEDULED", null);
  console.log(`  Product sync job ${productJob.id}: ${productJob.status}`);
  if (productJob.summary) console.log(`  ${JSON.stringify(productJob.summary)}`);
  if (productJob.errorMessage) console.log(`  Error: ${productJob.errorMessage}`);

  console.log("Running scheduled SAP customer sync...");
  const customerJob = await runCustomerSync("SCHEDULED", null);
  console.log(`  Customer sync job ${customerJob.id}: ${customerJob.status}`);
  if (customerJob.summary) console.log(`  ${JSON.stringify(customerJob.summary)}`);
  if (customerJob.errorMessage) console.log(`  Error: ${customerJob.errorMessage}`);

  if (productJob.status === "FAILED" || customerJob.status === "FAILED") {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Scheduled SAP sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
