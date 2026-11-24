import { parseScaledDecimal } from "@/lib/picking/validation";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";

/**
 * Claim composition: for every product that appears on a claim line, how
 * much was DELIVERED (invoiced), ACCEPTED, REJECTED and physically
 * RETURNED, why (claim reason) and what it is worth (value).
 *
 * Pure aggregation over already-fetched rows (no Prisma import) so the
 * arithmetic is unit-testable and the dashboard, its charts and any
 * export all read the very same numbers.
 *
 * Definitions (documented because the dashboard shows them):
 *   - delivered  = quantity on the invoice line(s) the claim lines point at.
 *                  An invoice line referenced by several claim lines is
 *                  counted ONCE (de-duplicated by invoiceLineId), never
 *                  once per claim. A claim line with no invoice line has no
 *                  known delivered quantity; the product is then flagged
 *                  `deliveredComplete = false` instead of guessing.
 *   - accepted / rejected = InvoiceClaimLine.acceptedQuantity /
 *                  rejectedQuantity, summed.
 *   - returned   = sum of ClaimReturn.receivedQuantity for those lines
 *                  (goods that physically came back).
 *   - value      = the line's disputed value priced at the REAL invoice
 *                  unit price (same rule as lib/invoice-claims/financial.ts,
 *                  so totals reconcile with "potential credit exposure").
 *                  Kept per currency, never summed across currencies. A line
 *                  whose price cannot be determined contributes nothing and
 *                  is counted in `valueIncompleteLines` -- never invented.
 *   - A claim is NOT a credit note and not a confirmed loss: this module
 *     reports what was disputed, not what SAP credited.
 *
 * Quantities are summed only WITHIN a product (one unit of measure), never
 * across products, so kg and cartons are never added together.
 */

export type ClaimCompositionInputLine = {
  claimLineId: string;
  productKey: string;
  sapItemCode: string | null;
  description: string | null;
  unit: string | null;
  invoiceLineId: string | null;
  deliveredQuantity: string | null;
  acceptedQuantity: string | null;
  rejectedQuantity: string | null;
  /** Sum of ClaimReturn.receivedQuantity for this line ("0" when none). */
  returnedQuantity: string;
  reasonCategory: string | null;
  /** Disputed value in `currency`, or null when it cannot be computed without inventing a price. */
  value: string | null;
  currency: string;
};

export type ClaimCompositionRow = {
  productKey: string;
  sapItemCode: string | null;
  description: string | null;
  /** null when the product's lines disagree on unit of measure. */
  unit: string | null;
  claimLineCount: number;
  delivered: string;
  deliveredComplete: boolean;
  accepted: string;
  rejected: string;
  returned: string;
  valueByCurrency: { currency: string; value: string }[];
  valueIncompleteLines: number;
  topReason: { reasonCategory: string; claimLineCount: number } | null;
};

export type ClaimCompositionSummary = {
  claimLineCount: number;
  productCount: number;
  valueByCurrency: { currency: string; value: string }[];
  valueIncompleteLines: number;
  byReason: { reasonCategory: string | null; claimLineCount: number; valueByCurrency: { currency: string; value: string }[] }[];
};

const ZERO = BigInt(0);

function scaled(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return ZERO;
  return parseScaledDecimal(value) ?? ZERO;
}

function addToCurrencyMap(map: Map<string, bigint>, currency: string, amount: bigint) {
  map.set(currency, (map.get(currency) ?? ZERO) + amount);
}

function currencyMapToRows(map: Map<string, bigint>): { currency: string; value: string }[] {
  return [...map.entries()]
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] < b[1] ? 1 : -1))
    .map(([currency, value]) => ({ currency, value: formatScaledDecimal(value) }));
}

export function aggregateClaimComposition(
  lines: ClaimCompositionInputLine[],
  options: { topProducts?: number } = {}
): { rows: ClaimCompositionRow[]; summary: ClaimCompositionSummary } {
  type Acc = {
    base: Pick<ClaimCompositionRow, "productKey" | "sapItemCode" | "description">;
    units: Set<string | null>;
    claimLineCount: number;
    seenInvoiceLines: Set<string>;
    delivered: bigint;
    deliveredComplete: boolean;
    accepted: bigint;
    rejected: bigint;
    returned: bigint;
    value: Map<string, bigint>;
    incomplete: number;
    reasons: Map<string, number>;
  };

  const byProduct = new Map<string, Acc>();
  const totalValue = new Map<string, bigint>();
  const reasonAcc = new Map<string | null, { count: number; value: Map<string, bigint> }>();
  let totalIncomplete = 0;

  for (const line of lines) {
    const acc =
      byProduct.get(line.productKey) ??
      ({
        base: { productKey: line.productKey, sapItemCode: line.sapItemCode, description: line.description },
        units: new Set<string | null>(),
        claimLineCount: 0,
        seenInvoiceLines: new Set<string>(),
        delivered: ZERO,
        deliveredComplete: true,
        accepted: ZERO,
        rejected: ZERO,
        returned: ZERO,
        value: new Map<string, bigint>(),
        incomplete: 0,
        reasons: new Map<string, number>(),
      } satisfies Acc);

    acc.claimLineCount += 1;
    acc.units.add(line.unit);

    if (line.invoiceLineId && line.deliveredQuantity !== null) {
      if (!acc.seenInvoiceLines.has(line.invoiceLineId)) {
        acc.seenInvoiceLines.add(line.invoiceLineId);
        acc.delivered += scaled(line.deliveredQuantity);
      }
    } else {
      acc.deliveredComplete = false;
    }

    acc.accepted += scaled(line.acceptedQuantity);
    acc.rejected += scaled(line.rejectedQuantity);
    acc.returned += scaled(line.returnedQuantity);

    const valueScaled = line.value === null ? null : parseScaledDecimal(line.value);
    if (valueScaled === null) {
      acc.incomplete += 1;
      totalIncomplete += 1;
    } else {
      addToCurrencyMap(acc.value, line.currency, valueScaled);
      addToCurrencyMap(totalValue, line.currency, valueScaled);
    }

    if (line.reasonCategory) acc.reasons.set(line.reasonCategory, (acc.reasons.get(line.reasonCategory) ?? 0) + 1);

    const reason = reasonAcc.get(line.reasonCategory) ?? { count: 0, value: new Map<string, bigint>() };
    reason.count += 1;
    if (valueScaled !== null) addToCurrencyMap(reason.value, line.currency, valueScaled);
    reasonAcc.set(line.reasonCategory, reason);

    byProduct.set(line.productKey, acc);
  }

  const rows: ClaimCompositionRow[] = [...byProduct.values()].map((acc) => {
    const topReasonEntry = [...acc.reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      ...acc.base,
      unit: acc.units.size === 1 ? [...acc.units][0] : null,
      claimLineCount: acc.claimLineCount,
      delivered: formatScaledDecimal(acc.delivered),
      deliveredComplete: acc.deliveredComplete,
      accepted: formatScaledDecimal(acc.accepted),
      rejected: formatScaledDecimal(acc.rejected),
      returned: formatScaledDecimal(acc.returned),
      valueByCurrency: currencyMapToRows(acc.value),
      valueIncompleteLines: acc.incomplete,
      topReason: topReasonEntry ? { reasonCategory: topReasonEntry[0], claimLineCount: topReasonEntry[1] } : null,
    };
  });

  // Most-rejected products first; ties broken by claim-line count then name for a stable order.
  rows.sort((a, b) => {
    const diff = scaled(b.rejected) - scaled(a.rejected);
    if (diff !== ZERO) return diff > ZERO ? 1 : -1;
    if (b.claimLineCount !== a.claimLineCount) return b.claimLineCount - a.claimLineCount;
    return (a.description ?? a.productKey).localeCompare(b.description ?? b.productKey);
  });

  const limited = options.topProducts ? rows.slice(0, options.topProducts) : rows;

  return {
    rows: limited,
    summary: {
      claimLineCount: lines.length,
      productCount: rows.length,
      valueByCurrency: currencyMapToRows(totalValue),
      valueIncompleteLines: totalIncomplete,
      byReason: [...reasonAcc.entries()]
        .map(([reasonCategory, r]) => ({ reasonCategory, claimLineCount: r.count, valueByCurrency: currencyMapToRows(r.value) }))
        .sort((a, b) => b.claimLineCount - a.claimLineCount),
    },
  };
}
