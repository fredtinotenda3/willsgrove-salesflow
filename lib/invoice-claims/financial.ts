import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 6A. Financial exposure computation (spec section 7).
 *
 * Distinguishes, per the spec: original invoice value, claimed value,
 * disputed value, accepted value, potential credit exposure, approved
 * credit exposure, actual SAP-credited amount, remaining unresolved
 * exposure. Currencies are NEVER converted or mixed -- every aggregate
 * here is grouped by currencyCode (read from SapInvoice.currencyCode,
 * never duplicated onto the claim/claim-line, since one invoice -- and
 * therefore every claim against it -- has exactly one currency), and a
 * null currencyCode (an invoice imported without one) is reported as its
 * own explicit "UNKNOWN" bucket rather than silently merged into any
 * real currency's total.
 *
 * Milestone 6B update: "actualSapCreditedAmount" is now a live SUM of
 * CreditNote.amount across every credit note recorded/matched against
 * this claim (lib/returns-credits/credit-notes.ts and execute-import.ts)
 * -- never a stored running total, same "derive, don't store a second
 * truth" convention as every other aggregate in this project -- with
 * actualCreditDataAvailable now always true (the capability exists; the
 * amount may legitimately be "0.0000" when nothing has been recorded
 * yet). Still never computed as an ESTIMATE from the claim lines
 * themselves (spec: "never calculate an actual credit amount based only
 * on an estimated claim") -- it only ever sums real CreditNote rows, each
 * of which records an actual SAP document a human or the 6B importer
 * entered. actualCreditShortfall and actualExceedsApproved are new in
 * 6B: the latter flags (never clamps) the exception where SAP has
 * credited more than was internally approved, mirroring Milestone 5's
 * own causesOverInvoicing philosophy of surfacing an exception rather
 * than hiding it.
 */

function formatSignedScaled(scaled: bigint): string {
  const negative = scaled < BigInt(0);
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(5, "0");
  const whole = digits.slice(0, -4);
  const fraction = digits.slice(-4);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function decimalToString(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toString();
}

/**
 * One claim line's disputed value, in the invoice's own currency, as a
 * decimal string -- or null when it genuinely cannot be computed without
 * inventing a figure (a QUANTITY dispute against an SapInvoiceLine with
 * no unitPrice at all, which Milestone 5 allows since "do not invent
 * missing SAP fields" applies there too).
 *
 * Deliberately uses the REAL invoiced unitPrice, never
 * disputedUnitPrice (the customer's own claimed price, informational
 * only -- spec section 4) -- "claimed value" always traces back to an
 * actual SAP-sourced figure, never a customer's assertion.
 */
export function computeClaimLineDisputedValue(line: {
  disputeType: string;
  rejectedQuantity: Prisma.Decimal | null;
  disputedAmount: Prisma.Decimal | null;
}, sapLine: { unitPrice: Prisma.Decimal | null }): string | null {
  if (line.disputeType === "AMOUNT_ONLY") {
    return decimalToString(line.disputedAmount);
  }
  // QUANTITY
  if (sapLine.unitPrice === null || line.rejectedQuantity === null) {
    return null;
  }
  // Both operands are @db.Decimal(18,4), so their exact product can carry
  // up to 8 decimal places -- rounded to 4 (this project's money scale,
  // matching every Decimal(18,4) column) rather than left at full
  // precision or truncated via float conversion.
  return line.rejectedQuantity.times(sapLine.unitPrice).toDecimalPlaces(4).toString();
}

export type ClaimFinancialSummary = {
  currencyCode: string | null;
  originalInvoiceValue: string | null; // SapInvoice.total, read as-is -- never recomputed
  claimedValue: string; // sum of every line's disputed value that could be computed
  claimedValueIncomplete: boolean; // true if one or more lines couldn't be priced (missing unitPrice) -- UI must show this, never silently understate
  potentialCreditExposure: string; // == claimedValue, before any manager approval
  approvedCreditExposure: string; // sum of approvedCreditAmount across this claim's APPROVED resolutions
  actualSapCreditedAmount: string; // Milestone 6B: live sum of CreditNote.amount recorded/matched against this claim -- "0.0000" when none yet
  actualCreditDataAvailable: true; // Milestone 6B: always true now -- the capability exists, the amount may just be zero
  remainingUnresolvedExposure: string; // max(0, potentialCreditExposure - approvedCreditExposure) -- unchanged meaning from 6A
  actualCreditShortfall: string; // Milestone 6B: max(0, approvedCreditExposure - actualSapCreditedAmount) -- what SAP still owes against what was approved
  actualExceedsApproved: boolean; // Milestone 6B: true when actualSapCreditedAmount > approvedCreditExposure -- flagged, never clamped
};

export async function computeClaimFinancialSummary(claimId: string): Promise<ClaimFinancialSummary | null> {
  const claim = await prisma.invoiceClaim.findUnique({
    where: { id: claimId },
    select: {
      sapInvoice: { select: { currencyCode: true, total: true } },
      lines: {
        select: {
          disputeType: true,
          rejectedQuantity: true,
          disputedAmount: true,
          sapInvoiceLine: { select: { unitPrice: true } },
        },
      },
      resolutions: {
        where: { approvedById: { not: null } },
        select: { approvedCreditAmount: true },
      },
      creditNotes: {
        select: { amount: true },
      },
    },
  });
  if (!claim) return null;

  let claimedValueScaled = BigInt(0);
  let claimedValueIncomplete = false;

  for (const line of claim.lines) {
    const value = computeClaimLineDisputedValue(line, line.sapInvoiceLine);
    if (value === null) {
      claimedValueIncomplete = true;
      continue;
    }
    // Scale via parseScaledDecimal (lib/picking/validation.ts) -- the one
    // decimal-string-to-exact-bigint conversion this project uses
    // everywhere money/quantity is summed, rather than a Decimal-object
    // method that may not exist on decimal.js's real API.
    const scaled = parseScaledDecimal(value);
    if (scaled !== null) claimedValueScaled += scaled;
  }

  let approvedCreditScaled = BigInt(0);
  for (const resolution of claim.resolutions) {
    if (resolution.approvedCreditAmount === null) continue;
    const scaled = parseScaledDecimal(resolution.approvedCreditAmount.toDecimalPlaces(4).toString());
    if (scaled !== null) approvedCreditScaled += scaled;
  }

  const remainingScaled = claimedValueScaled - approvedCreditScaled;

  // Milestone 6B: live sum of every CreditNote actually recorded/matched
  // against this claim -- never a stored running total.
  let actualCreditedScaled = BigInt(0);
  for (const creditNote of claim.creditNotes) {
    const scaled = parseScaledDecimal(creditNote.amount.toDecimalPlaces(4).toString());
    if (scaled !== null) actualCreditedScaled += scaled;
  }

  const shortfallScaled = approvedCreditScaled - actualCreditedScaled;
  const actualExceedsApproved = actualCreditedScaled > approvedCreditScaled;

  return {
    currencyCode: claim.sapInvoice.currencyCode,
    originalInvoiceValue: claim.sapInvoice.total ? claim.sapInvoice.total.toString() : null,
    claimedValue: formatSignedScaled(claimedValueScaled),
    claimedValueIncomplete,
    potentialCreditExposure: formatSignedScaled(claimedValueScaled),
    approvedCreditExposure: formatSignedScaled(approvedCreditScaled),
    actualSapCreditedAmount: formatSignedScaled(actualCreditedScaled),
    actualCreditDataAvailable: true,
    remainingUnresolvedExposure: formatSignedScaled(remainingScaled > BigInt(0) ? remainingScaled : BigInt(0)),
    actualCreditShortfall: formatSignedScaled(shortfallScaled > BigInt(0) ? shortfallScaled : BigInt(0)),
    actualExceedsApproved,
  };
}

export type CurrencyExposureBucket = {
  currencyCode: string; // "UNKNOWN" when the underlying invoice had none
  claimCount: number;
  potentialCreditExposure: string;
  approvedCreditExposure: string;
  actualSapCreditedAmount: string; // Milestone 6B: sum of each claim's live actualSapCreditedAmount
};

/**
 * Dashboard-level aggregate (spec section 8: "potential/approved/actual
 * credit exposure by currency"). Computed by walking each claim's own
 * summary rather than a single SQL aggregate, because claimedValue
 * depends on a per-line computation (rejectedQuantity * unitPrice) that
 * isn't a stored column -- same "derive, don't store" tradeoff this
 * project has made before when a roll-up needs a value no column holds.
 * Fine at this milestone's expected claim volume; revisit with a
 * materialized aggregate if claim volume grows large enough to matter.
 */
export async function computeExposureByCurrency(claimIds: string[]): Promise<CurrencyExposureBucket[]> {
  const buckets = new Map<string, { claimCount: number; potentialScaled: bigint; approvedScaled: bigint; actualScaled: bigint }>();

  for (const claimId of claimIds) {
    const summary = await computeClaimFinancialSummary(claimId);
    if (!summary) continue;
    const key = summary.currencyCode ?? "UNKNOWN";
    const bucket = buckets.get(key) ?? { claimCount: 0, potentialScaled: BigInt(0), approvedScaled: BigInt(0), actualScaled: BigInt(0) };
    bucket.claimCount += 1;
    const potentialScaled = parseScaledDecimal(summary.potentialCreditExposure);
    const approvedScaled = parseScaledDecimal(summary.approvedCreditExposure);
    const actualScaled = parseScaledDecimal(summary.actualSapCreditedAmount);
    if (potentialScaled !== null) bucket.potentialScaled += potentialScaled;
    if (approvedScaled !== null) bucket.approvedScaled += approvedScaled;
    if (actualScaled !== null) bucket.actualScaled += actualScaled;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries()).map(([currencyCode, bucket]) => ({
    currencyCode,
    claimCount: bucket.claimCount,
    potentialCreditExposure: formatSignedScaled(bucket.potentialScaled),
    approvedCreditExposure: formatSignedScaled(bucket.approvedScaled),
    actualSapCreditedAmount: formatSignedScaled(bucket.actualScaled),
  }));
}
