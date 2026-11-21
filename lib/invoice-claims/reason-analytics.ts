import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter } from "@/lib/reporting/filters";
import { CLAIM_LINE_REASON_CATEGORIES, CLAIM_LINE_REASON_CATEGORY_LABELS, type ClaimLineReasonCategory } from "@/lib/invoice-claims/validation";

/**
 * Management Analytics / Claims Standardisation spec, Part 5: "Connect
 * the standardised rejection reasons to Lost Sales + analytics." This
 * module answers the spec's own named questions -- how many claims per
 * reason, which products/customers are repeatedly affected, which
 * reasons account for the highest affected quantities/financial
 * exposure -- for `InvoiceClaimLine.reasonCategory`, the field Part 4
 * standardised onto the 8 named reasons.
 *
 * Deliberately NEVER folded into lib/lost-sales/queries.ts's own
 * Source A / Source B figures, and deliberately never summed into
 * "confirmed lost value": a claim is a customer-reported dispute, not
 * an automatic confirmed loss (spec Part 5, verbatim: "do NOT
 * automatically classify a claim as confirmed lost revenue simply
 * because a rejection reason was recorded" -- Price Claim may resolve
 * via price correction, Poor Quality Product via replacement, Short
 * Delivered may be fulfilled later, etc.). This module's own output is
 * named accordingly:
 *   - claimLineCount / claimedQuantity: what was DISPUTED (a quantity
 *     dispute's rejectedQuantity) -- a fact about the claim, not a loss.
 *   - informationalExposureByCurrency: the CUSTOMER's claimed value,
 *     from InvoiceClaimLine.disputedAmount (AMOUNT_ONLY lines) or
 *     rejectedQuantity x disputedUnitPrice where the customer supplied
 *     one (QUANTITY lines) -- same "informational only, never applied
 *     to a real invoice value" status that field already carries on the
 *     schema (see InvoiceClaimLine.disputedUnitPrice's own comment).
 *     This is exposure, not a confirmed loss, and is reported
 *     separately from lib/lost-sales/queries.ts's confirmed-lost
 *     figures, never summed with them. Kept PER CURRENCY (from each
 *     claim's own SapInvoice.currencyCode), one row per currency
 *     present, and never summed across currencies -- the same rule
 *     lib/reporting/financial-exposure.ts's computeExposureByCurrency
 *     already follows and its own test locks down ("keeps a USD claim
 *     and a non-USD claim as separate, un-summed rows").
 *   - resolvedCount / outstandingCount: the claim's own
 *     InvoiceClaimStatus, grouped per CLAIM_STATUS_IS_RESOLVED below --
 *     "resolved" here means the claim investigation concluded one way
 *     or another (RESOLVED/PARTIALLY_RESOLVED count as resolved;
 *     REJECTED/CLOSED also conclude it), never that a financial loss
 *     was confirmed (ClaimResolution/CreditNote/ClaimReturn, read
 *     separately in lib/returns-credits/, are the actual record of
 *     what financially happened, outside this module's scope).
 *
 * Legacy claim lines created under the superseded 10-reason wording
 * (PRODUCT_NOT_ORDERED/PRODUCT_NOT_DELIVERED, see
 * lib/invoice-claims/validation.ts) are included in their own row,
 * "Other (legacy reason)" -- dropping them from analytics entirely
 * would silently under-count real historical claims; a historical
 * claim's own data is never discarded.
 */

const LEGACY_LABEL = "Other (legacy reason)";
const LEGACY_KEY = "__LEGACY__";

const RESOLVED_CLAIM_STATUSES = new Set(["RESOLVED", "PARTIALLY_RESOLVED", "REJECTED", "CLOSED"]);

export type ClaimReasonBreakdownRow = {
  reasonCategory: string;
  label: string;
  claimLineCount: number;
  distinctClaimCount: number;
  claimedQuantity: string;
  /** One entry per currency actually present -- never summed across currencies. Empty when no line in this reason had a resolvable exposure amount. */
  informationalExposureByCurrency: { currency: string; amount: string }[];
  resolvedCount: number;
  outstandingCount: number;
  topProducts: { sapItemCode: string | null; description: string | null; claimLineCount: number; claimedQuantity: string }[];
  topCustomers: { customerId: string; customerName: string; claimLineCount: number; claimedQuantity: string }[];
};

export type ClaimReasonAnalytics = {
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
  totalClaimLines: number;
  byReason: ClaimReasonBreakdownRow[];
};

const TOP_N = 5;

/**
 * Only the filters this breakdown actually honors: `includeDemo` (via
 * InvoiceClaim.isDemo), `dateFrom`/`dateTo` (via InvoiceClaim.claimDate,
 * a date-only field -- dateRangeToDateOnlyFilter, not the timestamp
 * variant), and `customerId` (via InvoiceClaim.customerId). Every other
 * ReportFilters field is intentionally ignored here, the same
 * "state null when a filter doesn't apply to this report" convention
 * lib/reporting/types.ts's own comment documents for every other report
 * in this codebase -- the caller page is expected to show its own note
 * for any filter the shared filter bar still displays but this
 * function does not use.
 */
export async function getClaimReasonAnalytics(filters: Pick<ReportFilters, "includeDemo" | "dateFrom" | "dateTo" | "customerId">): Promise<ClaimReasonAnalytics> {
  const dateFilter = dateRangeToDateOnlyFilter(filters);

  const lines = await prisma.invoiceClaimLine.findMany({
    where: {
      claim: {
        ...demoWhere(filters),
        ...(Object.keys(dateFilter).length > 0 ? { claimDate: dateFilter } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
      },
    },
    select: {
      reasonCategory: true,
      disputeType: true,
      rejectedQuantity: true,
      disputedAmount: true,
      disputedUnitPrice: true,
      sapItemCodeSnapshot: true,
      sapItemDescriptionSnapshot: true,
      // Real-world fix (native Invoice Claims): order.currency is the
      // fallback currency source for a claim with no sapInvoice.
      claim: {
        select: {
          id: true,
          customerId: true,
          status: true,
          customer: { select: { name: true } },
          sapInvoice: { select: { currencyCode: true } },
          order: { select: { currency: true } },
        },
      },
    },
  });

  type Bucket = {
    claimLineCount: number;
    claimIds: Set<string>;
    claimedQuantity: number;
    /** currency code ("UNKNOWN" when the invoice has none) -> summed exposure, kept separate so currencies are never blended. */
    informationalExposureByCurrency: Map<string, number>;
    resolvedCount: number;
    outstandingCount: number;
    products: Map<string, { sapItemCode: string | null; description: string | null; claimLineCount: number; claimedQuantity: number }>;
    customers: Map<string, { customerId: string; customerName: string; claimLineCount: number; claimedQuantity: number }>;
  };

  function newBucket(): Bucket {
    return { claimLineCount: 0, claimIds: new Set(), claimedQuantity: 0, informationalExposureByCurrency: new Map(), resolvedCount: 0, outstandingCount: 0, products: new Map(), customers: new Map() };
  }

  const buckets = new Map<string, Bucket>();
  for (const key of [...CLAIM_LINE_REASON_CATEGORIES, LEGACY_KEY]) buckets.set(key, newBucket());

  for (const line of lines) {
    const key = line.reasonCategory && (CLAIM_LINE_REASON_CATEGORIES as readonly string[]).includes(line.reasonCategory) ? line.reasonCategory : LEGACY_KEY;
    // A line with no reasonCategory at all (legacy, pre-Part-6 claim, or
    // the documented "optional for backward compatibility" case) is not
    // a standardised-reason claim at all -- excluded from this
    // breakdown entirely rather than forced into the legacy bucket,
    // which is reserved for claims that DID record a reasonCategory,
    // just not one of the current 8.
    if (!line.reasonCategory) continue;

    const bucket = buckets.get(key)!;
    bucket.claimLineCount += 1;
    bucket.claimIds.add(line.claim.id);

    const quantity = line.disputeType === "QUANTITY" ? Number(line.rejectedQuantity ?? 0) : 0;
    bucket.claimedQuantity += quantity;

    const exposure =
      line.disputeType === "AMOUNT_ONLY"
        ? Number(line.disputedAmount ?? 0)
        : line.disputedUnitPrice
          ? quantity * Number(line.disputedUnitPrice)
          : 0;
    if (exposure !== 0) {
      const currency = line.claim.sapInvoice?.currencyCode ?? line.claim.order?.currency ?? "UNKNOWN";
      bucket.informationalExposureByCurrency.set(currency, (bucket.informationalExposureByCurrency.get(currency) ?? 0) + exposure);
    }

    if (RESOLVED_CLAIM_STATUSES.has(line.claim.status)) bucket.resolvedCount += 1;
    else bucket.outstandingCount += 1;

    const productKey = line.sapItemCodeSnapshot ?? `__no-code__${line.sapItemDescriptionSnapshot ?? "unknown"}`;
    const product = bucket.products.get(productKey) ?? { sapItemCode: line.sapItemCodeSnapshot, description: line.sapItemDescriptionSnapshot, claimLineCount: 0, claimedQuantity: 0 };
    product.claimLineCount += 1;
    product.claimedQuantity += quantity;
    bucket.products.set(productKey, product);

    const customer = bucket.customers.get(line.claim.customerId) ?? { customerId: line.claim.customerId, customerName: line.claim.customer.name, claimLineCount: 0, claimedQuantity: 0 };
    customer.claimLineCount += 1;
    customer.claimedQuantity += quantity;
    bucket.customers.set(line.claim.customerId, customer);
  }

  function topN<T extends { claimLineCount: number }>(items: Map<string, T>, n: number): T[] {
    return [...items.values()].sort((a, b) => b.claimLineCount - a.claimLineCount).slice(0, n);
  }

  const byReason: ClaimReasonBreakdownRow[] = [...CLAIM_LINE_REASON_CATEGORIES, LEGACY_KEY]
    .map((key) => {
      const bucket = buckets.get(key)!;
      return {
        reasonCategory: key,
        label: key === LEGACY_KEY ? LEGACY_LABEL : CLAIM_LINE_REASON_CATEGORY_LABELS[key as ClaimLineReasonCategory],
        claimLineCount: bucket.claimLineCount,
        distinctClaimCount: bucket.claimIds.size,
        claimedQuantity: bucket.claimedQuantity.toFixed(4),
        informationalExposureByCurrency: [...bucket.informationalExposureByCurrency.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
        resolvedCount: bucket.resolvedCount,
        outstandingCount: bucket.outstandingCount,
        topProducts: topN(bucket.products, TOP_N).map((p) => ({ ...p, claimedQuantity: p.claimedQuantity.toFixed(4) })),
        topCustomers: topN(bucket.customers, TOP_N).map((c) => ({ ...c, claimedQuantity: c.claimedQuantity.toFixed(4) })),
      };
    })
    // The legacy bucket is only shown when it actually has data -- most
    // installations going forward will have none, and an always-present
    // zero row would be visual noise.
    .filter((row) => row.reasonCategory !== LEGACY_KEY || row.claimLineCount > 0);

  return {
    effectiveDateFrom: filters.dateFrom ?? null,
    effectiveDateTo: filters.dateTo ?? null,
    totalClaimLines: byReason.reduce((sum, row) => sum + row.claimLineCount, 0),
    byReason,
  };
}
