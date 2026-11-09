/**
 * Milestone 2B. Shared text normalization for product/customer matching
 * and alias storage/lookup -- the ONE place "is this the same text as
 * that" gets decided, so alias writes (lib/matching/aliases.ts), alias
 * lookups, and the fuzzy matchers' tokenization can never drift from
 * each other and silently stop recognizing text that's really the same.
 *
 * Deliberately conservative: lowercases, trims, collapses whitespace,
 * strips diacritics and a short list of punctuation that never carries
 * matching-relevant meaning (commas, quotes, parentheses) -- but keeps
 * every digit and word character, INCLUDING pack-size/unit words
 * ("punnet", "kg", "250g", "box"). Those are exactly what distinguishes
 * two different pack sizes or preparations of what might look like "the
 * same" product, and the Milestone 2 brief is explicit that those must
 * never be merged -- so normalization here must never be aggressive
 * enough to make two genuinely different lines collapse to one key.
 */

const DIACRITICS_PATTERN = /[̀-ͯ]/g;
const STRIP_PUNCTUATION_PATTERN = /[,.;:!?'"()[\]{}]/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Normalizes free text for exact-match alias lookup/storage. NOT used
 * for fuzzy scoring directly -- see tokenize() below, which normalizes
 * and then splits.
 */
export function normalizeMatchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITICS_PATTERN, "")
    .replace(STRIP_PUNCTUATION_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

/**
 * Splits normalized text into tokens for overlap-based fuzzy scoring.
 * Empty input produces an empty array, never [""].
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeMatchText(text);
  return normalized === "" ? [] : normalized.split(" ");
}

/**
 * Dice coefficient (2 * |intersection| / (|A| + |B|)) over two token
 * lists, treated as sets (duplicates within one list don't inflate the
 * score). Returns 0 for two empty lists rather than NaN -- "nothing to
 * compare" is never treated as "a perfect match."
 */
export function diceCoefficient(tokensA: string[], tokensB: string[]): number {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of setA) {
    if (setB.has(token)) intersectionSize++;
  }

  return (2 * intersectionSize) / (setA.size + setB.size);
}

/**
 * Shared "is the top-scored candidate confident AND unambiguous enough
 * to pre-select" decision, factored out of product-matcher.ts and
 * customer-matcher.ts (which were previously two near-identical copies
 * of this exact logic) so the one decision rule can't silently drift
 * between the two, and so it's unit-testable on its own, without a
 * database, from ITS pure inputs (a pre-scored, already-sorted-desc
 * candidate list) rather than only indirectly through a full matcher
 * call.
 *
 * `scored` MUST already be sorted descending by score -- this does not
 * sort it itself, since both callers already need the full sorted list
 * for their own `candidates` field.
 */
export function selectConfidentMatch<T extends { score: number }>(
  scored: readonly T[],
  confidentThreshold: number,
  ambiguityGap: number
): T | null {
  const top = scored[0];
  if (!top || top.score <= 0) return null;

  const second = scored[1];
  const isConfidentAndUnambiguous = top.score >= confidentThreshold && (!second || top.score - second.score >= ambiguityGap);
  return isConfidentAndUnambiguous ? top : null;
}
