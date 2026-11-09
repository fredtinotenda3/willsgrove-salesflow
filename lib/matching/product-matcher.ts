/**
 * Milestone 2B. Resolves one extracted line's free-text description to a
 * real SAP Product -- deterministic, no AI call, consistent with the
 * Milestone 2 brief's "deterministic wherever possible" instruction
 * extended naturally from extraction (Milestone 2A) into matching here.
 *
 * Two-stage, in this order, and never the second once the first hits:
 *  1. ProductAlias exact lookup (lib/matching/aliases.ts) -- a mapping a
 *     human has already confirmed before. Confidence 1.0, never
 *     re-scored against anything.
 *  2. Token-overlap ("Dice coefficient") fuzzy scoring against active
 *     Products, narrowed first by a DB query on the description's own
 *     significant tokens so this never does a full-table scan.
 *
 * "Never merge similar products/pack sizes" (Milestone 2 brief, section
 * 3): deliberately NOT handled by stripping pack-size/unit words before
 * scoring -- the opposite. Product.itemName already encodes pack size in
 * its own text (Milestone 1 data, e.g. "Baby Marrow 250G Punnet"), so
 * keeping those words as ordinary tokens in the Dice score means two
 * different pack sizes of the same vegetable naturally score lower
 * against each other than two descriptions of the truly same product --
 * without any special-cased "pack size words" list to maintain or get
 * wrong. See normalizeMatchText's own comment for the same reasoning.
 *
 * Confidence thresholds below are a documented, honest, UNVERIFIED
 * assumption -- there is no real set of customer-wording-to-SAP-item
 * matches to calibrate against yet (same caveat class as Milestone 2A's
 * loose Excel/CSV header matching). Tune FUZZY_CONFIDENT_THRESHOLD and
 * FUZZY_AMBIGUITY_GAP here, in one place, once real review-workspace
 * usage shows whether they're too eager or too conservative.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { diceCoefficient, selectConfidentMatch, tokenize } from "@/lib/matching/normalize";
import { lookupProductAlias } from "@/lib/matching/aliases";

export type ProductMatchCandidate = {
  productId: string;
  sapItemCode: string;
  itemName: string;
  score: number;
};

export type ProductMatchResult = {
  /** Non-null only when confident and unambiguous enough to pre-select -- never a guess the review UI should silently trust without the human seeing it. */
  matchedProductId: string | null;
  matchConfidence: number | null;
  matchSource: "NONE" | "ALIAS" | "FUZZY";
  candidates: ProductMatchCandidate[];
};

export const FUZZY_CONFIDENT_THRESHOLD = 0.72;
export const FUZZY_AMBIGUITY_GAP = 0.15;
export const MAX_CANDIDATES = 5;
const MAX_DB_CANDIDATES = 50;
const MIN_TOKEN_LENGTH_FOR_DB_FILTER = 2;

const NO_MATCH: ProductMatchResult = { matchedProductId: null, matchConfidence: null, matchSource: "NONE", candidates: [] };

export async function matchProductDescription(
  description: string,
  customerId: string | null
): Promise<ProductMatchResult> {
  const alias = await lookupProductAlias(description, customerId);
  if (alias) {
    const product = await prisma.product.findUnique({
      where: { id: alias.productId },
      select: { id: true, sapItemCode: true, itemName: true },
    });
    // The Cascade delete on ProductAlias.productId (prisma/schema.prisma)
    // means this should never be null in practice -- defensive fall
    // through to fuzzy matching below rather than trusting a dangling
    // reference, if it somehow is.
    if (product) {
      return {
        matchedProductId: product.id,
        matchConfidence: 1,
        matchSource: "ALIAS",
        candidates: [{ productId: product.id, sapItemCode: product.sapItemCode, itemName: product.itemName, score: 1 }],
      };
    }
  }

  const descriptionTokens = tokenize(description);
  const significantTokens = descriptionTokens.filter((token) => token.length >= MIN_TOKEN_LENGTH_FOR_DB_FILTER);
  if (significantTokens.length === 0) {
    return NO_MATCH;
  }

  const dbCandidates = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        ...significantTokens.map((token) => ({ itemName: { contains: token, mode: "insensitive" as const } })),
        ...significantTokens.map((token) => ({ sapItemCode: { contains: token } })),
      ],
    },
    select: { id: true, sapItemCode: true, itemName: true },
    take: MAX_DB_CANDIDATES,
  });

  if (dbCandidates.length === 0) {
    return NO_MATCH;
  }

  const scored: ProductMatchCandidate[] = dbCandidates
    .map((product) => {
      let score = diceCoefficient(descriptionTokens, tokenize(product.itemName));
      // A description token that exactly equals this product's own SAP
      // item code (e.g. the customer wrote "0228 Baby Marrow punnet") is
      // a near-certain signal, stronger than pure word overlap -- but
      // only raises the floor, never lowers a genuinely stronger text
      // match.
      if (descriptionTokens.includes(product.sapItemCode.toLowerCase())) {
        score = Math.max(score, 0.95);
      }
      return { productId: product.id, sapItemCode: product.sapItemCode, itemName: product.itemName, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) {
    return NO_MATCH;
  }

  const confident = selectConfidentMatch(scored, FUZZY_CONFIDENT_THRESHOLD, FUZZY_AMBIGUITY_GAP);

  return {
    matchedProductId: confident?.productId ?? null,
    matchConfidence: top.score,
    matchSource: "FUZZY",
    candidates: scored.slice(0, MAX_CANDIDATES),
  };
}
