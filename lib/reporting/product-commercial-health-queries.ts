import "server-only";
import { prisma } from "@/lib/prisma";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { resolveAsOfDate, type AsOfDateSource } from "@/lib/reporting/customer-recency";
import { computeExposureByCurrency, type CurrencyExposureBucket } from "@/lib/invoice-claims/financial";
import { currencyKey } from "@/lib/reporting/sales-revenue";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { resolveSingleProductSapItemCode } from "@/lib/reporting/product-commercial-health";
import { itemKey } from "@/lib/reporting/product-purchasing";
import { rankByValue } from "@/lib/reporting/product-segmentation";

/**
 * Milestone 14 (Product Intelligence). Claim/return/credit-note
 * product-attribution queries -- spec sections 4.4, 4.B items 6/7, 5.7.
 *
 * The two structural schema gaps established during inspection (see
 * lib/reporting/product-commercial-health.ts's own top comment) mean a
 * claim or a credit note can be attributed to ONE product only when
 * every line it touches resolves to that same single SAP item code.
 * Rather than silently drop a claim that names this product ALONGSIDE
 * others, every function below reports TWO distinct figures, never
 * merged:
 *   - claimCount (and returnCount): INCLUSIVE -- any claim/return that
 *     touches this product at all, a reliable, un-guessed fact ("this
 *     product appeared in N claims").
 *   - exposureByCurrency / actualCreditNotes: CONSERVATIVE -- computed
 *     ONLY from claims/invoices that resolve to this product and no
 *     other, via resolveSingleProductSapItemCode. A claim or credit note
 *     that spans multiple products is excluded from this money figure
 *     and counted instead in an explicit multiProductClaimCount /
 *     unattributableCreditNoteCount, so the limitation is always visible
 *     on screen, never silently absorbed into any one product's total.
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project.
 */

type ClaimAttribution = {
  /** claimId -> every distinct sapItemCode touched by that claim's own lines. */
  itemCodesByClaim: Map<string, Set<string>>;
  claimDateByClaim: Map<string, Date>;
  closedAtByClaim: Map<string, Date | null>;
};

/**
 * Fetches every InvoiceClaimLine's claimId + its own SapInvoiceLine's
 * sapItemCode, in ONE query, and groups by claim -- the shared building
 * block both the Product 360 profile and the management overview use to
 * resolve single-vs-multi-product claims, so the resolution rule is
 * never computed twice.
 */
async function loadClaimAttribution(filters: Pick<ReportFilters, "includeDemo">): Promise<ClaimAttribution> {
  const demo = demoWhere(filters);
  const lines = await prisma.invoiceClaimLine.findMany({
    where: { claim: { ...demo } },
    select: { claimId: true, sapInvoiceLine: { select: { sapItemCode: true } }, claim: { select: { claimDate: true, closedAt: true } } },
  });

  const itemCodesByClaim = new Map<string, Set<string>>();
  const claimDateByClaim = new Map<string, Date>();
  const closedAtByClaim = new Map<string, Date | null>();
  for (const line of lines) {
    const set = itemCodesByClaim.get(line.claimId) ?? new Set<string>();
    if (line.sapInvoiceLine.sapItemCode) set.add(itemKey(line.sapInvoiceLine.sapItemCode));
    itemCodesByClaim.set(line.claimId, set);
    claimDateByClaim.set(line.claimId, line.claim.claimDate);
    closedAtByClaim.set(line.claimId, line.claim.closedAt);
  }
  return { itemCodesByClaim, claimDateByClaim, closedAtByClaim };
}

function resolveClaimItem(itemCodes: Set<string>): { kind: "single"; sapItemCode: string } | { kind: "multiple" } | { kind: "none" } {
  return resolveSingleProductSapItemCode([...itemCodes]);
}

type InvoiceAttribution = {
  /** sapInvoiceId -> every distinct sapItemCode on that invoice's own lines. */
  itemCodesByInvoice: Map<string, Set<string>>;
};

async function loadInvoiceAttribution(filters: Pick<ReportFilters, "includeDemo">, invoiceIds: readonly string[]): Promise<InvoiceAttribution> {
  const itemCodesByInvoice = new Map<string, Set<string>>();
  if (invoiceIds.length === 0) return { itemCodesByInvoice };
  const demo = demoWhere(filters);
  const lines = await prisma.sapInvoiceLine.findMany({
    where: { sapInvoiceId: { in: [...invoiceIds] }, ...demo },
    select: { sapInvoiceId: true, sapItemCode: true },
  });
  for (const line of lines) {
    const set = itemCodesByInvoice.get(line.sapInvoiceId) ?? new Set<string>();
    if (line.sapItemCode) set.add(itemKey(line.sapItemCode));
    itemCodesByInvoice.set(line.sapInvoiceId, set);
  }
  return { itemCodesByInvoice };
}

// ---------------------------------------------------------------------------
// Product 360 profile.
// ---------------------------------------------------------------------------

export type ProductCommercialHealth = {
  periodFrom: string;
  periodTo: string;
  asOfDate: string;
  asOfDateSource: AsOfDateSource;
  claims: {
    /** Inclusive: any claim with >=1 line for this product, claimDate inside the period. */
    raisedInPeriodCount: number;
    /** Calculated -- see lib/reporting/customer-commercial-health-queries.ts's own "open as of" approximation comment, applied here at product scope. Inclusive set, same as raisedInPeriodCount. */
    openAsOfReportingDateCount: number;
    /** Of the claims counted above, how many touch more than one product -- excluded from exposureByCurrency below, never silently absorbed. */
    multiProductClaimCount: number;
    /** All-time, current-state exposure by currency -- reused verbatim from lib/invoice-claims/financial.ts, computed ONLY from claims that resolve to this product and no other. */
    exposureByCurrency: CurrencyExposureBucket[];
  };
  returns: {
    inPeriodByCondition: { condition: string; count: number }[];
    /** Claim-level returns (no specific claimLineId) on a claim that spans more than one product -- cannot be attributed to this product specifically, so excluded from the figure above and counted here instead. */
    unattributableReturnCountInPeriod: number;
  };
  actualCreditNotes: {
    inPeriodByCurrency: { currency: string; total: string }[];
    allTimeCumulativeByCurrency: { currency: string; total: string }[];
    excludedFromPeriodNoDateCount: number;
    /** Claim-linked notes on multi-product claims, plus direct-invoice-linked notes on multi-product invoices -- real credit notes that exist but cannot be reliably attributed to this product alone, never silently dropped. */
    unattributableCreditNoteCount: number;
  };
};

export async function getProductCommercialHealth(sapItemCode: string, filters: ReportFilters): Promise<ProductCommercialHealth> {
  const item = itemKey(sapItemCode);
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const { asOfDate, source: asOfDateSource } = resolveAsOfDate({ dateTo: filters.dateTo });
  const asOfDateUtc = dateOnlyStringToUtcDate(asOfDate)!;
  const dayAfterAsOf = new Date(asOfDateUtc);
  dayAfterAsOf.setUTCDate(dayAfterAsOf.getUTCDate() + 1);

  const { itemCodesByClaim, claimDateByClaim, closedAtByClaim } = await loadClaimAttribution(filters);

  const claimIdsForProduct: string[] = [];
  const singleProductClaimIds: string[] = [];
  let multiProductClaimCount = 0;
  for (const [claimId, items] of itemCodesByClaim.entries()) {
    if (!items.has(item)) continue;
    claimIdsForProduct.push(claimId);
    const resolution = resolveClaimItem(items);
    if (resolution.kind === "single" && resolution.sapItemCode === item) {
      singleProductClaimIds.push(claimId);
    } else {
      multiProductClaimCount += 1;
    }
  }

  const raisedInPeriodCount = claimIdsForProduct.filter((id) => {
    const d = claimDateByClaim.get(id)!;
    return (!periodDateRange.gte || d >= periodDateRange.gte) && (!periodDateRange.lte || d <= periodDateRange.lte);
  }).length;
  const openAsOfReportingDateCount = claimIdsForProduct.filter((id) => {
    const claimDate = claimDateByClaim.get(id)!;
    const closedAt = closedAtByClaim.get(id)!;
    return claimDate <= asOfDateUtc && (closedAt === null || closedAt >= dayAfterAsOf);
  }).length;
  const exposureByCurrency = singleProductClaimIds.length > 0 ? await computeExposureByCurrency(singleProductClaimIds) : [];

  // --- Returns ---
  const productClaimLines = await prisma.invoiceClaimLine.findMany({
    where: { sapInvoiceLine: { sapItemCode }, claim: { ...demo } },
    select: { id: true },
  });
  const productClaimLineIds = productClaimLines.map((l) => l.id);

  const [lineResolvedReturns, claimLevelReturnsOnSingleProductClaims, claimLevelReturnsOnMultiProductClaims] = await Promise.all([
    productClaimLineIds.length > 0
      ? prisma.claimReturn.findMany({ where: { claimLineId: { in: productClaimLineIds }, ...demo, receivedDate: periodDateRange }, select: { condition: true } })
      : Promise.resolve([]),
    singleProductClaimIds.length > 0
      ? prisma.claimReturn.findMany({ where: { claimLineId: null, claimId: { in: singleProductClaimIds }, ...demo, receivedDate: periodDateRange }, select: { condition: true } })
      : Promise.resolve([]),
    claimIdsForProduct.length > 0
      ? prisma.claimReturn.count({ where: { claimLineId: null, claimId: { in: claimIdsForProduct.filter((id) => !singleProductClaimIds.includes(id)) }, ...demo, receivedDate: periodDateRange } })
      : Promise.resolve(0),
  ]);

  const returnsByCondition = new Map<string, number>();
  for (const r of [...lineResolvedReturns, ...claimLevelReturnsOnSingleProductClaims]) {
    returnsByCondition.set(r.condition, (returnsByCondition.get(r.condition) ?? 0) + 1);
  }

  // --- Credit notes: claim-linked (single-product claims) union
  // direct-invoice-linked (single-product invoices), never double-counted
  // (mutually exclusive by construction -- one requires a linked claim,
  // the other requires claimId: null). ---
  const invoiceIdsWithProduct = (
    await prisma.sapInvoiceLine.findMany({ where: { sapItemCode, ...demo }, select: { sapInvoiceId: true }, distinct: ["sapInvoiceId"] })
  ).map((r) => r.sapInvoiceId);
  const { itemCodesByInvoice } = await loadInvoiceAttribution(filters, invoiceIdsWithProduct);
  const singleProductInvoiceIds: string[] = [];
  let multiProductInvoiceLinkedNoteCandidateCount = 0;
  for (const invoiceId of invoiceIdsWithProduct) {
    const items = itemCodesByInvoice.get(invoiceId) ?? new Set<string>();
    const resolution = resolveClaimItem(items);
    if (resolution.kind === "single" && resolution.sapItemCode === item) singleProductInvoiceIds.push(invoiceId);
    else multiProductInvoiceLinkedNoteCandidateCount += 1;
  }

  const [claimLinkedNotes, directLinkedNotes, multiProductClaimLinkedNoteCount, multiProductDirectLinkedNoteCount] = await Promise.all([
    singleProductClaimIds.length > 0 ? prisma.creditNote.findMany({ where: { claimId: { in: singleProductClaimIds }, ...demo }, select: { amount: true, currencyCode: true, creditNoteDate: true } }) : Promise.resolve([]),
    singleProductInvoiceIds.length > 0
      ? prisma.creditNote.findMany({ where: { claimId: null, sapInvoiceId: { in: singleProductInvoiceIds }, ...demo }, select: { amount: true, currencyCode: true, creditNoteDate: true } })
      : Promise.resolve([]),
    prisma.creditNote.count({ where: { claimId: { in: claimIdsForProduct.filter((id) => !singleProductClaimIds.includes(id)) }, ...demo } }),
    multiProductInvoiceLinkedNoteCandidateCount > 0
      ? prisma.creditNote.count({ where: { claimId: null, sapInvoiceId: { in: invoiceIdsWithProduct.filter((id) => !singleProductInvoiceIds.includes(id)) }, ...demo } })
      : Promise.resolve(0),
  ]);

  type CurrencyBucket = { inPeriod: string[]; allTime: string[] };
  const creditByCurrency = new Map<string, CurrencyBucket>();
  let excludedFromPeriodNoDateCount = 0;
  for (const note of [...claimLinkedNotes, ...directLinkedNotes]) {
    const currency = currencyKey(note.currencyCode);
    const bucket = creditByCurrency.get(currency) ?? { inPeriod: [], allTime: [] };
    const amount = note.amount.toString();
    bucket.allTime.push(amount);
    if (note.creditNoteDate === null) {
      excludedFromPeriodNoDateCount += 1;
    } else if ((!periodDateRange.gte || note.creditNoteDate >= periodDateRange.gte) && (!periodDateRange.lte || note.creditNoteDate <= periodDateRange.lte)) {
      bucket.inPeriod.push(amount);
    }
    creditByCurrency.set(currency, bucket);
  }
  const inPeriodByCurrency = [...creditByCurrency.entries()].filter(([, b]) => b.inPeriod.length > 0).map(([currency, b]) => ({ currency, total: formatScaledDecimal(sumDecimalStrings(b.inPeriod)) }));
  const allTimeCumulativeByCurrency = [...creditByCurrency.entries()].map(([currency, b]) => ({ currency, total: b.allTime.length > 0 ? formatScaledDecimal(sumDecimalStrings(b.allTime)) : "0" }));

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    asOfDate,
    asOfDateSource,
    claims: { raisedInPeriodCount, openAsOfReportingDateCount, multiProductClaimCount, exposureByCurrency },
    returns: {
      inPeriodByCondition: [...returnsByCondition.entries()].map(([condition, count]) => ({ condition, count })),
      unattributableReturnCountInPeriod: claimLevelReturnsOnMultiProductClaims,
    },
    actualCreditNotes: {
      inPeriodByCurrency,
      allTimeCumulativeByCurrency,
      excludedFromPeriodNoDateCount,
      unattributableCreditNoteCount: multiProductClaimLinkedNoteCount + multiProductDirectLinkedNoteCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Management overview: products ranked by claim/return activity (spec 4.B
// item 6) and by actual credit-note value (spec 4.B item 7).
// ---------------------------------------------------------------------------

export type ProductClaimActivityRow = { sapItemCode: string; productId: string | null; claimCount: number; returnCount: number; rank: number };
export type ProductCreditNoteValueRow = { sapItemCode: string; currency: string; total: string; rank: number };

export async function getProductClaimAndReturnOverview(filters: ReportFilters): Promise<{ rows: ProductClaimActivityRow[]; multiProductClaimCount: number }> {
  const { itemCodesByClaim } = await loadClaimAttribution(filters);
  const demo = demoWhere(filters);

  const claimCountByItem = new Map<string, number>();
  let multiProductClaimCount = 0;
  const singleProductClaimIdsByItem = new Map<string, string[]>();
  for (const [claimId, items] of itemCodesByClaim.entries()) {
    for (const item of items) claimCountByItem.set(item, (claimCountByItem.get(item) ?? 0) + 1);
    const resolution = resolveClaimItem(items);
    if (resolution.kind === "single") {
      const list = singleProductClaimIdsByItem.get(resolution.sapItemCode) ?? [];
      list.push(claimId);
      singleProductClaimIdsByItem.set(resolution.sapItemCode, list);
    } else if (resolution.kind === "multiple") {
      multiProductClaimCount += 1;
    }
  }

  const allSingleProductClaimIds = [...singleProductClaimIdsByItem.values()].flat();
  const returnCountByItem = new Map<string, number>();
  if (allSingleProductClaimIds.length > 0) {
    const returns = await prisma.claimReturn.findMany({ where: { claimId: { in: allSingleProductClaimIds }, ...demo }, select: { claimId: true } });
    const itemByClaim = new Map<string, string>();
    for (const [item, ids] of singleProductClaimIdsByItem.entries()) for (const id of ids) itemByClaim.set(id, item);
    for (const r of returns) {
      const item = itemByClaim.get(r.claimId);
      if (item) returnCountByItem.set(item, (returnCountByItem.get(item) ?? 0) + 1);
    }
  }

  const universe = [...claimCountByItem.keys()];
  const ranked = rankByValue(universe.map((sapItemCode) => ({ sapItemCode, value: claimCountByItem.get(sapItemCode) ?? 0 })), "descending");
  const rankByItem = new Map(ranked.map((r) => [r.sapItemCode, r.rank]));

  const rows: ProductClaimActivityRow[] = universe
    .map((sapItemCode) => ({
      sapItemCode,
      productId: null,
      claimCount: claimCountByItem.get(sapItemCode) ?? 0,
      returnCount: returnCountByItem.get(sapItemCode) ?? 0,
      rank: rankByItem.get(sapItemCode)!,
    }))
    .sort((a, b) => a.rank - b.rank);

  return { rows, multiProductClaimCount };
}

export async function getProductCreditNoteValueOverview(filters: ReportFilters): Promise<{ rows: ProductCreditNoteValueRow[]; unattributableCreditNoteCount: number }> {
  const demo = demoWhere(filters);
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const { itemCodesByClaim } = await loadClaimAttribution(filters);
  const singleProductClaimIdsByItem = new Map<string, string[]>();
  const multiProductClaimIds = new Set<string>();
  for (const [claimId, items] of itemCodesByClaim.entries()) {
    const resolution = resolveClaimItem(items);
    if (resolution.kind === "single") {
      const list = singleProductClaimIdsByItem.get(resolution.sapItemCode) ?? [];
      list.push(claimId);
      singleProductClaimIdsByItem.set(resolution.sapItemCode, list);
    } else if (resolution.kind === "multiple") {
      multiProductClaimIds.add(claimId);
    }
  }
  const itemByClaimId = new Map<string, string>();
  for (const [item, ids] of singleProductClaimIdsByItem.entries()) for (const id of ids) itemByClaimId.set(id, item);

  const claimLinkedNotes = await prisma.creditNote.findMany({
    where: { claimId: { in: [...itemByClaimId.keys()] }, ...demo, creditNoteDate: periodDateRange },
    select: { claimId: true, amount: true, currencyCode: true },
  });

  const allInvoiceLines = await prisma.sapInvoiceLine.findMany({ where: { sapItemCode: { not: null }, ...demo }, select: { sapInvoiceId: true, sapItemCode: true } });
  const itemCodesByInvoice = new Map<string, Set<string>>();
  for (const line of allInvoiceLines) {
    const set = itemCodesByInvoice.get(line.sapInvoiceId) ?? new Set<string>();
    if (line.sapItemCode) set.add(itemKey(line.sapItemCode));
    itemCodesByInvoice.set(line.sapInvoiceId, set);
  }
  const itemByInvoiceId = new Map<string, string>();
  let multiProductInvoiceCount = 0;
  for (const [invoiceId, items] of itemCodesByInvoice.entries()) {
    const resolution = resolveClaimItem(items);
    if (resolution.kind === "single") itemByInvoiceId.set(invoiceId, resolution.sapItemCode);
    else if (resolution.kind === "multiple") multiProductInvoiceCount += 1;
  }

  const directLinkedNotes = await prisma.creditNote.findMany({
    where: { claimId: null, sapInvoiceId: { in: [...itemByInvoiceId.keys()] }, ...demo, creditNoteDate: periodDateRange },
    select: { sapInvoiceId: true, amount: true, currencyCode: true },
  });

  type Bucket = Map<string, string[]>; // currency -> amounts
  const byItemCurrency = new Map<string, Bucket>();
  for (const note of claimLinkedNotes) {
    const item = itemByClaimId.get(note.claimId!);
    if (!item) continue;
    const currency = currencyKey(note.currencyCode);
    const itemBucket = byItemCurrency.get(item) ?? new Map<string, string[]>();
    const amounts = itemBucket.get(currency) ?? [];
    amounts.push(note.amount.toString());
    itemBucket.set(currency, amounts);
    byItemCurrency.set(item, itemBucket);
  }
  for (const note of directLinkedNotes) {
    const item = itemByInvoiceId.get(note.sapInvoiceId!);
    if (!item) continue;
    const currency = currencyKey(note.currencyCode);
    const itemBucket = byItemCurrency.get(item) ?? new Map<string, string[]>();
    const amounts = itemBucket.get(currency) ?? [];
    amounts.push(note.amount.toString());
    itemBucket.set(currency, amounts);
    byItemCurrency.set(item, itemBucket);
  }

  const unattributableCreditNoteCount =
    (await prisma.creditNote.count({ where: { claimId: { in: [...multiProductClaimIds] }, ...demo, creditNoteDate: periodDateRange } })) +
    (multiProductInvoiceCount > 0
      ? await prisma.creditNote.count({
          where: { claimId: null, sapInvoiceId: { in: [...itemCodesByInvoice.keys()].filter((id) => !itemByInvoiceId.has(id)) }, ...demo, creditNoteDate: periodDateRange },
        })
      : 0);

  const rankInputByCurrency = new Map<string, { sapItemCode: string; value: number }[]>();
  for (const [item, bucket] of byItemCurrency.entries()) {
    for (const [currency, amounts] of bucket.entries()) {
      const list = rankInputByCurrency.get(currency) ?? [];
      list.push({ sapItemCode: item, value: Number(formatScaledDecimal(sumDecimalStrings(amounts))) });
      rankInputByCurrency.set(currency, list);
    }
  }

  const rows: ProductCreditNoteValueRow[] = [];
  for (const [currency, items] of rankInputByCurrency.entries()) {
    const ranked = rankByValue(items, "descending");
    for (const r of ranked) {
      const amounts = byItemCurrency.get(r.sapItemCode)!.get(currency)!;
      rows.push({ sapItemCode: r.sapItemCode, currency, total: formatScaledDecimal(sumDecimalStrings(amounts)), rank: r.rank });
    }
  }
  rows.sort((a, b) => a.currency.localeCompare(b.currency) || a.rank - b.rank);

  return { rows, unattributableCreditNoteCount };
}
