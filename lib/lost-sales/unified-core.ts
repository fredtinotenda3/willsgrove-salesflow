import { parseScaledDecimal } from "@/lib/picking/validation";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { CLAIM_LINE_REASON_CATEGORIES, CLAIM_LINE_REASON_CATEGORY_LABELS, type ClaimLineReasonCategory } from "@/lib/invoice-claims/validation";

/**
 * UNIFIED LOST SALES + STANDARDISED CLAIM-REASON ANALYTICS (pure core).
 *
 * One implementation, used by the Invoice Claims dashboard, the Lost Sales
 * Analytics page, the management recommendations and the Action Centre, so
 * the same claim never has two values or two interpretations. No Prisma
 * import: the server module (unified-queries.ts) only fetches facts.
 *
 * SIX MEASURES, never merged into one number, always per currency/unit:
 *   1. unfulfilled          requested but not supplied (UnfulfilledDemand)
 *   2. rejectedAfterDelivery delivered, then rejected on a QUANTITY claim line
 *   3. returned             physically received back (ClaimReturn); a SUBSET
 *                           of rejected, shown beside it, never added to it
 *   4. confirmedLost        (a) shortage quantity confirmed lost, and
 *                           (b) returns judged non-resalable (the existing
 *                           ClaimReturnLostSale rule). A rejected quantity
 *                           that was not returned is NOT confirmed lost.
 *   5. underDispute         disputed value on claims not yet concluded,
 *                           minus what was actually credited
 *   6. recovered/retained   disputed value on concluded claims where the
 *                           recorded outcome means Willsgrove keeps the sale
 *
 * DOUBLE COUNTING: unfulfilled quantity was never dispatched, a claim line
 * needs a dispatched line, so the two sets are disjoint. A claim line and
 * its invoice line are one record. Returned quantity sits inside rejected.
 * Pricing disputes (AMOUNT_ONLY) carry no quantity, so they appear in
 * disputed VALUE but never in the rejected/returned QUANTITY measures.
 *
 * PARTIAL RESOLUTION is claim-level only: ClaimResolution and CreditNote
 * attach to the claim, not to a line, so a per-product split would need an
 * allocation rule that does not exist in the data. Claim-level it is exact.
 */

export const TERMINAL_CLAIM_STATUSES: readonly string[] = ["RESOLVED", "REJECTED", "CLOSED"];

/** Resolution decisions meaning the customer keeps paying: the sale is retained. (Approved default #3.) */
export const RETAINED_DECISIONS: readonly string[] = ["NO_ACTION_REQUIRED", "CLAIM_REJECTED", "PRICING_CORRECTION_REQUIRED"];
export const REPLACEMENT_DECISIONS: readonly string[] = ["REPLACEMENT_APPROVED"];

/** Lost-sales values that carry no currency of their own (UnfulfilledDemand) are USD, the currency of the price lists they are estimated from. */
export const UNFULFILLED_VALUE_CURRENCY = "USD";

const ZERO = BigInt(0);
const MAX_BUCKETS = 120;

function big(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return ZERO;
  return parseScaledDecimal(value) ?? ZERO;
}

export type MoneyRow = { currency: string; value: string };
export type UnitQuantityRow = { unit: string | null; quantity: string };

export type ClaimLineFact = {
  claimId: string;
  claimLineId: string;
  /** YYYY-MM-DD (InvoiceClaim.claimDate). */
  claimDate: string;
  claimStatus: string;
  customerId: string;
  customerName: string;
  productKey: string;
  sapItemCode: string | null;
  description: string | null;
  unit: string | null;
  reasonCategory: string | null;
  disputeType: "QUANTITY" | "AMOUNT_ONLY";
  rejectedQuantity: string | null;
  /** Sum of ClaimReturn.receivedQuantity for this line ("0" if none). */
  returnedQuantity: string;
  /** Disputed value at the REAL invoice unit price (lib/invoice-claims/financial.ts rule); null when it cannot be priced. */
  value: string | null;
  currency: string;
};

export type ClaimFact = {
  claimId: string;
  claimReference?: string;
  status: string;
  currency: string;
  customerId: string;
  customerName: string;
  /** Sum of CreditNote.amount recorded against the claim. */
  creditedAmount: string;
  /** Sum of approvedCreditAmount over approved resolutions. */
  approvedCreditAmount: string;
  /** Most recent non-rejected resolution decision, if any. */
  latestDecision: string | null;
};

export type ReturnLossFact = { claimId: string; currency: string; unit: string | null; quantity: string; value: string | null };

export type DemandFact = {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string;
  productKey: string;
  sapItemCode: string | null;
  description: string;
  unit: string | null;
  unavailableQuantity: string;
  confirmedLostQuantity: string;
  estimatedUnitPrice: string | null;
  /** estimatedValue for the whole unavailable quantity, null when never priced. */
  estimatedValue: string | null;
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

class MoneyMap {
  private map = new Map<string, bigint>();
  add(currency: string, amount: bigint) {
    this.map.set(currency, (this.map.get(currency) ?? ZERO) + amount);
  }
  rows(): MoneyRow[] {
    return [...this.map.entries()]
      .filter(([, v]) => v !== ZERO)
      .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] < b[1] ? 1 : -1))
      .map(([currency, v]) => ({ currency, value: formatScaledDecimal(v) }));
  }
}

class UnitMap {
  private map = new Map<string, bigint>();
  add(unit: string | null, amount: bigint) {
    const key = unit ?? "";
    this.map.set(key, (this.map.get(key) ?? ZERO) + amount);
  }
  rows(): UnitQuantityRow[] {
    return [...this.map.entries()]
      .filter(([, v]) => v !== ZERO)
      .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] < b[1] ? 1 : -1))
      .map(([unit, v]) => ({ unit: unit === "" ? null : unit, quantity: formatScaledDecimal(v) }));
  }
}

function minBig(a: bigint, b: bigint) {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// claim outcome (claim level)
// ---------------------------------------------------------------------------

export type ClaimOutcome = {
  disputed: bigint;
  credited: bigint;
  approvedNotYetCredited: bigint;
  underDispute: bigint;
  retained: bigint;
  replacement: bigint;
  /** Concluded, but the recorded decision does not say whether the sale was kept or lost: shown as such, never forced into a bucket. */
  unclassifiedConcluded: bigint;
  creditExceedsDisputed: boolean;
};

/**
 * Classifies one claim's disputed value. `credited` is always reported
 * separately from `disputed` (a credit note is the real SAP document; the
 * dispute is only a claim). Remaining = max(0, disputed - credited), so a
 * partially credited claim shows exactly what is still open.
 */
export function classifyClaimOutcome(claim: ClaimFact, disputed: bigint): ClaimOutcome {
  const credited = big(claim.creditedAmount);
  const approved = big(claim.approvedCreditAmount);
  const remaining = disputed > credited ? disputed - credited : ZERO;
  const base: ClaimOutcome = {
    disputed,
    credited,
    approvedNotYetCredited: approved > credited ? approved - credited : ZERO,
    underDispute: ZERO,
    retained: ZERO,
    replacement: ZERO,
    unclassifiedConcluded: ZERO,
    creditExceedsDisputed: credited > disputed,
  };

  if (!TERMINAL_CLAIM_STATUSES.includes(claim.status)) return { ...base, underDispute: remaining };
  if (claim.status === "REJECTED") return { ...base, retained: remaining };
  const decision = claim.latestDecision;
  if (decision && RETAINED_DECISIONS.includes(decision)) return { ...base, retained: remaining };
  if (decision && REPLACEMENT_DECISIONS.includes(decision)) return { ...base, replacement: remaining };
  return { ...base, unclassifiedConcluded: remaining };
}

// ---------------------------------------------------------------------------
// unified lost sales
// ---------------------------------------------------------------------------

export type UnifiedLostSales = {
  unfulfilled: { demandCount: number; quantityByUnit: UnitQuantityRow[]; value: MoneyRow[]; demandsWithoutPrice: number };
  rejectedAfterDelivery: { claimLineCount: number; quantityByUnit: UnitQuantityRow[]; valueByCurrency: MoneyRow[]; linesWithoutPrice: number };
  returned: { quantityByUnit: UnitQuantityRow[] };
  confirmedLost: {
    shortage: { quantityByUnit: UnitQuantityRow[]; value: MoneyRow[] };
    nonResalableReturns: { quantityByUnit: UnitQuantityRow[]; valueByCurrency: MoneyRow[] };
  };
  /** Claim-level value measures (all lines of a claim, quantity and pricing disputes). */
  disputedValueByCurrency: MoneyRow[];
  underDisputeByCurrency: MoneyRow[];
  retainedByCurrency: MoneyRow[];
  replacementByCurrency: MoneyRow[];
  unclassifiedConcludedByCurrency: MoneyRow[];
  creditedByCurrency: MoneyRow[];
  approvedNotYetCreditedByCurrency: MoneyRow[];
  claimCount: number;
  openClaimCount: number;
  claimsWhereCreditExceedsDisputed: number;
};

export function aggregateUnifiedLostSales(input: { claimLines: ClaimLineFact[]; claims: ClaimFact[]; returnLosses: ReturnLossFact[]; demands: DemandFact[] }): UnifiedLostSales {
  // 1. unfulfilled + shortage confirmed-lost
  const unfulfilledQty = new UnitMap();
  const unfulfilledVal = new MoneyMap();
  const shortageLostQty = new UnitMap();
  const shortageLostVal = new MoneyMap();
  let demandsWithoutPrice = 0;
  for (const d of input.demands) {
    unfulfilledQty.add(d.unit, big(d.unavailableQuantity));
    shortageLostQty.add(d.unit, big(d.confirmedLostQuantity));
    if (d.estimatedValue === null) demandsWithoutPrice += 1;
    else unfulfilledVal.add(UNFULFILLED_VALUE_CURRENCY, big(d.estimatedValue));
    if (d.estimatedUnitPrice !== null && big(d.confirmedLostQuantity) !== ZERO) {
      // exact: quantity (4dp) x price (4dp) -> 8dp, rounded half-up to 4dp
      const product = big(d.confirmedLostQuantity) * big(d.estimatedUnitPrice);
      const scale = BigInt(10000);
      shortageLostVal.add(UNFULFILLED_VALUE_CURRENCY, (product + scale / BigInt(2)) / scale);
    }
  }

  // 2/3. rejected + returned (QUANTITY lines only)
  const rejQty = new UnitMap();
  const rejVal = new MoneyMap();
  const retQty = new UnitMap();
  let rejLines = 0;
  let rejNoPrice = 0;
  const lineValueByClaim = new Map<string, bigint>();
  for (const l of input.claimLines) {
    if (l.value !== null) lineValueByClaim.set(l.claimId, (lineValueByClaim.get(l.claimId) ?? ZERO) + big(l.value));
    if (l.disputeType !== "QUANTITY") continue;
    const rejected = big(l.rejectedQuantity);
    if (rejected === ZERO) continue;
    rejLines += 1;
    rejQty.add(l.unit, rejected);
    // a return can never exceed what was rejected for the quantity measure
    retQty.add(l.unit, minBig(big(l.returnedQuantity), rejected));
    if (l.value === null) rejNoPrice += 1;
    else rejVal.add(l.currency, big(l.value));
  }

  // 4b. non-resalable returns (existing ClaimReturnLostSale rule)
  const nrQty = new UnitMap();
  const nrVal = new MoneyMap();
  for (const r of input.returnLosses) {
    nrQty.add(r.unit, big(r.quantity));
    if (r.value !== null) nrVal.add(r.currency, big(r.value));
  }

  // 5/6. claim-level outcome
  const disputedM = new MoneyMap();
  const underM = new MoneyMap();
  const retainedM = new MoneyMap();
  const replM = new MoneyMap();
  const unclM = new MoneyMap();
  const creditedM = new MoneyMap();
  const approvedM = new MoneyMap();
  let open = 0;
  let exceeds = 0;
  for (const c of input.claims) {
    const outcome = classifyClaimOutcome(c, lineValueByClaim.get(c.claimId) ?? ZERO);
    if (!TERMINAL_CLAIM_STATUSES.includes(c.status)) open += 1;
    if (outcome.creditExceedsDisputed) exceeds += 1;
    disputedM.add(c.currency, outcome.disputed);
    underM.add(c.currency, outcome.underDispute);
    retainedM.add(c.currency, outcome.retained);
    replM.add(c.currency, outcome.replacement);
    unclM.add(c.currency, outcome.unclassifiedConcluded);
    creditedM.add(c.currency, outcome.credited);
    approvedM.add(c.currency, outcome.approvedNotYetCredited);
  }

  return {
    unfulfilled: { demandCount: input.demands.length, quantityByUnit: unfulfilledQty.rows(), value: unfulfilledVal.rows(), demandsWithoutPrice },
    rejectedAfterDelivery: { claimLineCount: rejLines, quantityByUnit: rejQty.rows(), valueByCurrency: rejVal.rows(), linesWithoutPrice: rejNoPrice },
    returned: { quantityByUnit: retQty.rows() },
    confirmedLost: {
      shortage: { quantityByUnit: shortageLostQty.rows(), value: shortageLostVal.rows() },
      nonResalableReturns: { quantityByUnit: nrQty.rows(), valueByCurrency: nrVal.rows() },
    },
    disputedValueByCurrency: disputedM.rows(),
    underDisputeByCurrency: underM.rows(),
    retainedByCurrency: retainedM.rows(),
    replacementByCurrency: replM.rows(),
    unclassifiedConcludedByCurrency: unclM.rows(),
    creditedByCurrency: creditedM.rows(),
    approvedNotYetCreditedByCurrency: approvedM.rows(),
    claimCount: input.claims.length,
    openClaimCount: open,
    claimsWhereCreditExceedsDisputed: exceeds,
  };
}

// ---------------------------------------------------------------------------
// reason breakdown
// ---------------------------------------------------------------------------

export const NO_REASON_KEY = "__NONE__";
export const LEGACY_REASON_KEY = "__LEGACY__";

export type ReasonProductRow = { sapItemCode: string | null; description: string | null; claimLineCount: number; rejectedQuantity: string; unit: string | null };
export type ReasonCustomerRow = { customerId: string; customerName: string; claimLineCount: number };

export type ReasonRow = {
  reasonCategory: string;
  label: string;
  claimCount: number;
  claimLineCount: number;
  /** distinct claims in this reason / distinct claims overall, 1 dp. A claim with lines of several reasons counts under each, so shares can total more than 100%. */
  claimSharePercent: number | null;
  exposureByCurrency: MoneyRow[];
  /** Quantity per unit (never added across units): rejected and, separately, physically returned. */
  quantityByUnit: { unit: string | null; rejected: string; returned: string }[];
  openClaimCount: number;
  concludedClaimCount: number;
  topProducts: ReasonProductRow[];
  topCustomers: ReasonCustomerRow[];
  /** claim ids, for drilldown. */
  claimIds: string[];
};

export type TrendGranularity = "day" | "week" | "month";
export type ReasonTrend = {
  granularity: TrendGranularity;
  buckets: { key: string; label: string; counts: Record<string, number> }[];
  reasons: { reasonCategory: string; label: string }[];
};

export type ReasonBreakdown = {
  totalClaims: number;
  totalClaimLines: number;
  rows: ReasonRow[];
  trend: ReasonTrend;
};

export function reasonLabel(key: string): string {
  if (key === NO_REASON_KEY) return "No standardised reason recorded";
  if (key === LEGACY_REASON_KEY) return "Other (legacy reason)";
  return CLAIM_LINE_REASON_CATEGORY_LABELS[key as ClaimLineReasonCategory] ?? key;
}

function reasonKey(l: ClaimLineFact): string {
  if (!l.reasonCategory) return NO_REASON_KEY;
  return (CLAIM_LINE_REASON_CATEGORIES as readonly string[]).includes(l.reasonCategory) ? l.reasonCategory : LEGACY_REASON_KEY;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function mondayKey(d: Date): string {
  const offset = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
  return isoDate(new Date(d.getTime() - offset * DAY_MS));
}

export function chooseGranularity(from: string, to: string): TrendGranularity {
  const days = Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS) + 1;
  if (days <= 31) return "day";
  if (days <= 180) return "week";
  return "month";
}

function bucketKey(date: string, g: TrendGranularity): string {
  if (g === "day") return date;
  if (g === "week") return mondayKey(utc(date));
  return `${date.slice(0, 7)}-01`;
}

function bucketLabel(key: string, g: TrendGranularity): string {
  const d = utc(key);
  if (g === "month") return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function nextBucket(key: string, g: TrendGranularity): string {
  const d = utc(key);
  if (g === "day") return isoDate(new Date(d.getTime() + DAY_MS));
  if (g === "week") return isoDate(new Date(d.getTime() + 7 * DAY_MS));
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}

/**
 * Trend of claims-by-reason over time, bucketed by InvoiceClaim.claimDate
 * (the real date the claim was reported). Buckets between the first and
 * last date are filled with zero because "no claims that week" is a true
 * observation; nothing outside the filtered range or the data is invented.
 * Counts are distinct claims per reason per bucket.
 */
export function buildReasonTrend(lines: ClaimLineFact[], range?: { from?: string | null; to?: string | null }): ReasonTrend {
  const dates = lines.map((l) => l.claimDate).sort();
  const from = range?.from ?? dates[0];
  const to = range?.to ?? dates[dates.length - 1];
  const reasons = [...new Set(lines.map(reasonKey))];
  if (!from || !to || lines.length === 0) return { granularity: "week", buckets: [], reasons: [] };

  let g = chooseGranularity(from, to);
  const count = (gran: TrendGranularity) => {
    let n = 0;
    for (let k = bucketKey(from, gran); k <= to && n <= MAX_BUCKETS + 1; k = nextBucket(k, gran)) n += 1;
    return n;
  };
  if (count(g) > MAX_BUCKETS) g = g === "day" ? "week" : "month";

  const perBucket = new Map<string, Map<string, Set<string>>>();
  for (const l of lines) {
    if (l.claimDate < from || l.claimDate > to) continue;
    const bk = bucketKey(l.claimDate, g);
    const r = reasonKey(l);
    const byReason = perBucket.get(bk) ?? new Map<string, Set<string>>();
    const set = byReason.get(r) ?? new Set<string>();
    set.add(l.claimId);
    byReason.set(r, set);
    perBucket.set(bk, byReason);
  }

  const buckets: ReasonTrend["buckets"] = [];
  for (let k = bucketKey(from, g); k <= to && buckets.length <= MAX_BUCKETS; k = nextBucket(k, g)) {
    const counts: Record<string, number> = {};
    for (const r of reasons) counts[r] = perBucket.get(k)?.get(r)?.size ?? 0;
    buckets.push({ key: k, label: bucketLabel(k, g), counts });
  }
  return { granularity: g, buckets, reasons: reasons.map((r) => ({ reasonCategory: r, label: reasonLabel(r) })) };
}

export function buildReasonBreakdown(lines: ClaimLineFact[], range?: { from?: string | null; to?: string | null }): ReasonBreakdown {
  type Acc = {
    claimIds: Set<string>;
    open: Set<string>;
    concluded: Set<string>;
    lineCount: number;
    exposure: MoneyMap;
    qty: Map<string, { unit: string | null; rejected: bigint; returned: bigint }>;
    products: Map<string, { sapItemCode: string | null; description: string | null; unit: string | null; lines: number; rejected: bigint }>;
    customers: Map<string, ReasonCustomerRow>;
  };
  const accs = new Map<string, Acc>();
  const allClaims = new Set<string>();

  for (const l of lines) {
    allClaims.add(l.claimId);
    const key = reasonKey(l);
    const a =
      accs.get(key) ??
      ({ claimIds: new Set(), open: new Set(), concluded: new Set(), lineCount: 0, exposure: new MoneyMap(), qty: new Map(), products: new Map(), customers: new Map() } satisfies Acc);
    accs.set(key, a);
    a.claimIds.add(l.claimId);
    (TERMINAL_CLAIM_STATUSES.includes(l.claimStatus) ? a.concluded : a.open).add(l.claimId);
    a.lineCount += 1;
    if (l.value !== null) a.exposure.add(l.currency, big(l.value));

    const rejected = l.disputeType === "QUANTITY" ? big(l.rejectedQuantity) : ZERO;
    if (l.disputeType === "QUANTITY") {
      const uk = l.unit ?? "";
      const q = a.qty.get(uk) ?? { unit: l.unit, rejected: ZERO, returned: ZERO };
      q.rejected += rejected;
      q.returned += minBig(big(l.returnedQuantity), rejected);
      a.qty.set(uk, q);
    }
    const p = a.products.get(l.productKey) ?? { sapItemCode: l.sapItemCode, description: l.description, unit: l.unit, lines: 0, rejected: ZERO };
    p.lines += 1;
    p.rejected += rejected;
    a.products.set(l.productKey, p);
    const c = a.customers.get(l.customerId) ?? { customerId: l.customerId, customerName: l.customerName, claimLineCount: 0 };
    c.claimLineCount += 1;
    a.customers.set(l.customerId, c);
  }

  const totalClaims = allClaims.size;
  const rows: ReasonRow[] = [...accs.entries()]
    .map(([key, a]) => ({
      reasonCategory: key,
      label: reasonLabel(key),
      claimCount: a.claimIds.size,
      claimLineCount: a.lineCount,
      claimSharePercent: totalClaims === 0 ? null : Math.round((a.claimIds.size / totalClaims) * 1000) / 10,
      exposureByCurrency: a.exposure.rows(),
      quantityByUnit: [...a.qty.values()]
        .filter((q) => q.rejected !== ZERO || q.returned !== ZERO)
        .sort((x, y) => (x.rejected === y.rejected ? 0 : x.rejected < y.rejected ? 1 : -1))
        .map((q) => ({ unit: q.unit, rejected: formatScaledDecimal(q.rejected), returned: formatScaledDecimal(q.returned) })),
      openClaimCount: a.open.size,
      concludedClaimCount: a.concluded.size,
      topProducts: [...a.products.values()]
        .sort((x, y) => y.lines - x.lines || (x.rejected === y.rejected ? 0 : x.rejected < y.rejected ? 1 : -1))
        .slice(0, 5)
        .map((p) => ({ sapItemCode: p.sapItemCode, description: p.description, claimLineCount: p.lines, rejectedQuantity: formatScaledDecimal(p.rejected), unit: p.unit })),
      topCustomers: [...a.customers.values()].sort((x, y) => y.claimLineCount - x.claimLineCount).slice(0, 5),
      claimIds: [...a.claimIds],
    }))
    // ranked by number of claims; ties by lines then label so the order is stable
    .sort((x, y) => y.claimCount - x.claimCount || y.claimLineCount - x.claimLineCount || x.label.localeCompare(y.label));

  return { totalClaims, totalClaimLines: lines.length, rows, trend: buildReasonTrend(lines, range) };
}
