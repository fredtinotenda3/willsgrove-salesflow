/**
 * Milestone 2B. Resolves an extracted document header's
 * customerNameRaw/storeOrBranchRaw (lib/extraction/schema.ts) to a real
 * Customer -- same two-stage approach as lib/matching/product-matcher.ts
 * (alias exact lookup, then token-overlap fuzzy scoring against active
 * customers), for the same reason: deterministic, no AI call needed for
 * something this project already has real master data for.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { diceCoefficient, selectConfidentMatch, tokenize } from "@/lib/matching/normalize";
import { lookupCustomerAlias } from "@/lib/matching/aliases";

export type CustomerMatchCandidate = {
  customerId: string;
  name: string;
  storeCode: string | null;
  sapCustomerCode: string | null;
  score: number;
};

export type CustomerMatchResult = {
  matchedCustomerId: string | null;
  matchConfidence: number | null;
  matchSource: "NONE" | "ALIAS" | "FUZZY";
  candidates: CustomerMatchCandidate[];
};

export const CUSTOMER_FUZZY_CONFIDENT_THRESHOLD = 0.72;
export const CUSTOMER_FUZZY_AMBIGUITY_GAP = 0.15;
export const MAX_CUSTOMER_CANDIDATES = 5;
const MAX_DB_CANDIDATES = 50;
const MIN_TOKEN_LENGTH_FOR_DB_FILTER = 2;

const NO_MATCH: CustomerMatchResult = { matchedCustomerId: null, matchConfidence: null, matchSource: "NONE", candidates: [] };

/**
 * Combines the header's two separate free-text fields into one search
 * string -- the same combined text is what gets normalized for alias
 * lookup/storage, so a confirmed alias always keys on the same text a
 * later identical header would also produce.
 */
export function buildCustomerSearchText(customerNameRaw: string | null, storeOrBranchRaw: string | null): string {
  return [customerNameRaw, storeOrBranchRaw]
    .filter((part): part is string => Boolean(part && part.trim() !== ""))
    .join(" ")
    .trim();
}

export async function matchCustomerHeader(
  customerNameRaw: string | null,
  storeOrBranchRaw: string | null
): Promise<CustomerMatchResult> {
  const searchText = buildCustomerSearchText(customerNameRaw, storeOrBranchRaw);
  if (searchText === "") return NO_MATCH;

  const alias = await lookupCustomerAlias(searchText);
  if (alias) {
    const customer = await prisma.customer.findUnique({
      where: { id: alias.customerId },
      select: { id: true, name: true, storeCode: true, sapCustomerCode: true },
    });
    // Cascade delete on CustomerAlias.customerId means this should never
    // be null -- defensive fall-through to fuzzy matching if it somehow is.
    if (customer) {
      return {
        matchedCustomerId: customer.id,
        matchConfidence: 1,
        matchSource: "ALIAS",
        candidates: [
          { customerId: customer.id, name: customer.name, storeCode: customer.storeCode, sapCustomerCode: customer.sapCustomerCode, score: 1 },
        ],
      };
    }
  }

  const searchTokens = tokenize(searchText);
  const significantTokens = searchTokens.filter((token) => token.length >= MIN_TOKEN_LENGTH_FOR_DB_FILTER);
  if (significantTokens.length === 0) {
    return NO_MATCH;
  }

  const dbCandidates = await prisma.customer.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        ...significantTokens.map((token) => ({ name: { contains: token, mode: "insensitive" as const } })),
        ...significantTokens.map((token) => ({ storeCode: { contains: token, mode: "insensitive" as const } })),
        ...significantTokens.map((token) => ({ sapCustomerCode: { contains: token, mode: "insensitive" as const } })),
      ],
    },
    select: { id: true, name: true, storeCode: true, sapCustomerCode: true },
    take: MAX_DB_CANDIDATES,
  });

  if (dbCandidates.length === 0) {
    return NO_MATCH;
  }

  const scored: CustomerMatchCandidate[] = dbCandidates
    .map((customer) => {
      const candidateText = [customer.name, customer.storeCode ?? ""].join(" ");
      let score = diceCoefficient(searchTokens, tokenize(candidateText));
      if (customer.sapCustomerCode && searchTokens.includes(customer.sapCustomerCode.toLowerCase())) {
        score = Math.max(score, 0.95);
      }
      return { customerId: customer.id, name: customer.name, storeCode: customer.storeCode, sapCustomerCode: customer.sapCustomerCode, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) {
    return NO_MATCH;
  }

  const confident = selectConfidentMatch(scored, CUSTOMER_FUZZY_CONFIDENT_THRESHOLD, CUSTOMER_FUZZY_AMBIGUITY_GAP);

  return {
    matchedCustomerId: confident?.customerId ?? null,
    matchConfidence: top.score,
    matchSource: "FUZZY",
    candidates: scored.slice(0, MAX_CUSTOMER_CANDIDATES),
  };
}
