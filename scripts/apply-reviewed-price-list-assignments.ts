/**
 * One-command application of the human-reviewed customer -> price-list
 * mapping in business-data/reviewed-price-list-assignments.csv.
 *
 * Run with: npm run db:apply-price-list-assignments           (dry run, default)
 *           npm run db:apply-price-list-assignments -- --apply (writes)
 *
 * Context (Real Business Data Onboarding round, bulk price-list
 * assignment follow-up): the real customer-master export has no
 * price-list column at all (see app/price-lists/customers/page.tsx's own
 * comment and lib/customers.ts's bulkAssignPriceList), so every
 * assignment is a deliberate choice. app/price-lists/customers/page.tsx's
 * "Bulk assign" panel covers the common case -- a search term that
 * cleanly isolates a chain (e.g. "TM Supermarket") -- but several of the
 * 7 real price lists (OKUSDBYO's Bulawayo-only branches, HOSPI-USD's
 * hospitality sector, a small PNPUSD) don't reduce to one clean search
 * term, so matching by exact SAP customer code from a reviewed CSV is
 * the only safe way to apply them in bulk without either guessing from
 * name text or clicking through ~450 customers one at a time in the UI.
 *
 * This deliberately does NOT call lib/customers.ts's bulkAssignPriceList
 * -- that function's filter is a text search/category/status match,
 * exactly the imprecise mechanism this script exists to avoid for the
 * segments it can't cleanly express. Instead it matches by exact
 * sapCustomerCode, taken from a CSV that was produced by keyword
 * analysis but then reviewed row-by-row by Stanley (the business owner)
 * before being saved here -- the review is what makes this safe, not
 * the matching mechanism. The CSV is the audit trail: every row says
 * which customer, which list, and why.
 *
 * Defaults to a dry run (reports what WOULD change, writes nothing) --
 * pass --apply to actually write. This mirrors the production incident
 * this round's lib/customers.ts guard (isFilterEffectivelyEmpty /
 * confirmedUnfiltered) was built to prevent: a bulk customer mutation
 * should never be one flag or one missed step away from running by
 * accident.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

type Row = { sapCustomerCode: string; customerName: string; priceListCode: string; matchReason: string };

// Minimal CSV split: the generating script only ever quotes-and-escapes
// nothing (semicolons were substituted for commas inside name fields
// when the CSV was built), so a plain split is sufficient and avoids
// pulling in a CSV parsing dependency for a one-off admin script.
function parseCsv(path: string): Row[] {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const [, ...dataLines] = lines; // drop header

  return dataLines.map((line) => {
    const [sapCustomerCode, customerName, priceListCode, matchReason] = line.split(",");
    return { sapCustomerCode: sapCustomerCode.trim(), customerName: customerName.trim(), priceListCode: priceListCode.trim(), matchReason: (matchReason ?? "").trim() };
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const csvPath = join(process.cwd(), "business-data", "reviewed-price-list-assignments.csv");
  const rows = parseCsv(csvPath);

  console.log(`${apply ? "APPLYING" : "DRY RUN (pass --apply to write)"}: ${rows.length} reviewed rows from ${csvPath}\n`);

  const byList = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byList.get(row.priceListCode) ?? [];
    list.push(row);
    byList.set(row.priceListCode, list);
  }

  let totalMatched = 0;
  let totalMissing = 0;

  for (const [priceListCode, groupRows] of byList) {
    const priceList = await prisma.priceList.findUnique({ where: { code: priceListCode }, select: { id: true, code: true } });

    if (!priceList) {
      console.log(`SKIPPED ${priceListCode}: no price list with this code exists. 0/${groupRows.length} applied.\n`);
      continue;
    }

    const codes = groupRows.map((r) => r.sapCustomerCode);
    const existing = await prisma.customer.findMany({
      where: { sapCustomerCode: { in: codes } },
      select: { id: true, sapCustomerCode: true, priceListId: true },
    });

    const foundCodes = new Set(existing.map((c) => c.sapCustomerCode));
    const missing = codes.filter((c) => !foundCodes.has(c));

    console.log(`${priceListCode}: ${existing.length}/${groupRows.length} customers found in the database.`);
    if (missing.length > 0) {
      console.log(`  Not found (SAP code no longer matches any customer -- skipped): ${missing.join(", ")}`);
    }

    totalMatched += existing.length;
    totalMissing += missing.length;

    if (!apply || existing.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      const beforeGroups = new Map<string | null, number>();
      for (const c of existing) {
        beforeGroups.set(c.priceListId, (beforeGroups.get(c.priceListId) ?? 0) + 1);
      }

      const { count } = await tx.customer.updateMany({
        where: { sapCustomerCode: { in: codes } },
        data: { priceListId: priceList.id },
      });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "CUSTOMER_BULK_PRICE_LIST_ASSIGN",
          entityType: "Customer",
          entityId: "bulk-reviewed-import",
          beforeData: {
            source: "business-data/reviewed-price-list-assignments.csv",
            byPreviousPriceListId: Array.from(beforeGroups.entries()).map(([priceListId, count]) => ({ priceListId, count })),
          },
          afterData: { targetPriceListId: priceList.id, targetPriceListCode: priceList.code, matchedCount: count },
        },
      });

      console.log(`  Applied: ${count} customers -> ${priceListCode}.`);
    });
  }

  console.log(`\nTotal: ${totalMatched} matched${totalMissing > 0 ? `, ${totalMissing} not found` : ""}.`);
  if (!apply) console.log("Nothing was written. Re-run with --apply to write these changes.");
}

main()
  .catch((error) => {
    console.error("Applying reviewed price-list assignments failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
