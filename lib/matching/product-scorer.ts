/**
 * Pure, DB-free scoring of "what the customer wrote" against catalogue
 * item names. Kept separate from product-matcher.ts so it is unit-testable
 * and so the order-parsing route can score many lines against one
 * in-memory candidate pool instead of one query per line.
 *
 * Improvements over plain Dice on raw tokens:
 *  - singular/plural + spelling variants (blue berries / blueberries, brinjal / eggplant)
 *  - noise words (fresh, local, p/kg, pack) are down-weighted, not matched
 *  - pack size is compared numerically: 125g vs 125G match, 125g vs 250g are penalised
 *  - distinguishing tokens that appear in only one side (e.g. "red" vs "white") reduce the score
 */
import { diceCoefficient, normalizeMatchText } from "@/lib/matching/normalize";
import { packSizesEqual, parsePackSize } from "@/lib/po-parse/units";

const SYNONYMS: Record<string, string> = {
  eggplant: "brinjal", eggplants: "brinjal", aubergine: "brinjal", brinjals: "brinjal",
  courgette: "marrow", courgettes: "marrow", zucchini: "marrow",
  capsicum: "pepper", capsicums: "pepper", peppers: "pepper",
  pawpaw: "paw", papaya: "paw",
  naartjie: "naartjies", mandarin: "naartjies", tangerine: "naartjies",
  spud: "potato", potatoes: "potato", potatos: "potato",
  tomatoes: "tomato", tomatos: "tomato",
  mangoes: "mango", mangos: "mango",
  avocados: "avocado", avo: "avocado", avos: "avocado",
  broccolli: "broccoli", brocoli: "broccoli", brocolli: "broccoli",
  cauli: "cauliflower",
  strawberries: "strawberry", blueberries: "blueberry", cranberries: "cranberry",
  onions: "onion", carrots: "carrot", cabbages: "cabbage", cucumbers: "cucumber",
  oranges: "orange", lemons: "lemon", apples: "apple", pears: "pear", peaches: "peach",
  grapes: "grape", bananas: "banana", beans: "bean", peas: "pea", mushrooms: "mushroom",
  nectarines: "nectarine", plums: "plum", pumpkins: "pumpkin", beetroots: "beetroot",
  lettuces: "lettuce", gems: "gem", herbs: "herb", garlics: "garlic",
  forelle: "forrelle", forrele: "forrelle",
  pnp: "pnt", punnet: "pnt", punnets: "pnt", pnts: "pnt",
  pac: "pack", pkt: "pack", packet: "pack", packs: "pack", pkts: "pack", sachet: "pack", satchet: "pack",
  kilo: "kg", kilos: "kg", kgs: "kg",
  "g/s": "granny", "r/g": "red",
};

const NOISE = new Set([
  "fresh", "local", "p", "per", "pack", "pnt", "each", "ea", "kg", "x", "of", "the", "and", "&", "a", "an", "with", "in", "for",
  "large", "lrg", "med", "medium", "small", "sml", "econo", "ptn", "pkg", "unit", "box", "bag", "also", "mixed", "clean", "s",
]);

const SIZE_TOKEN = /^\d+(?:\.\d+)?(?:kg|g|gm|ml|l|s)?$/;

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && token.endsWith("es") && /(?:ch|sh|x|s|z|o)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export type ScoreTokens = { words: string[]; allWords: string[]; sizes: string[]; pack: ReturnType<typeof parsePackSize> };

export function scoreTokens(text: string): ScoreTokens {
  const pack = parsePackSize(text);
  const normalised = normalizeMatchText(text.replace(/\//g, " / ").replace(/-/g, " ").replace(/&/g, " and "))
    .replace(/(\d)\s*(kg|g|gm|ml|l)\b/g, "$1$2")
    .replace(/\bp\s*\/\s*kg\b/g, "per kg");
  const raw = normalised.split(" ").filter(Boolean);
  const allWords: string[] = [];
  const words: string[] = [];
  const sizes: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let token = raw[i]!;
    // "blue berries" -> "blueberries"
    if (raw[i + 1] && `${token}${raw[i + 1]}` === "blueberries") {
      token = "blueberries";
      i++;
    }
    if (token === "/") continue;
    if (SIZE_TOKEN.test(token) && /\d/.test(token)) {
      sizes.push(token);
      continue;
    }
    const mapped = SYNONYMS[token] ?? token;
    const s = SYNONYMS[stem(mapped)] ?? stem(mapped);
    allWords.push(s);
    if (!NOISE.has(s) && !NOISE.has(mapped) && s.length > 1) words.push(s);
  }
  return { words, allWords, sizes, pack };
}

export type ScoreResult = { score: number; packMatch: "equal" | "different" | "unknown" };

/** 0..1, higher is better. */
export function scoreProductMatch(descriptionOrTokens: string | ScoreTokens, candidateName: string, candidateTokens?: ScoreTokens, customerCode?: { wrote: string | null; candidateCode: string }): ScoreResult {
  const a = typeof descriptionOrTokens === "string" ? scoreTokens(descriptionOrTokens) : descriptionOrTokens;
  const b = candidateTokens ?? scoreTokens(candidateName);

  if (customerCode?.wrote && customerCode.wrote === customerCode.candidateCode) return { score: 0.98, packMatch: "unknown" };

  let base = diceCoefficient(a.words, b.words);
  if (base === 0) return { score: 0, packMatch: "unknown" };

  // Coverage: every word the customer wrote should be found in the product.
  const bSet = new Set(b.words);
  const covered = a.words.filter((w) => bSet.has(w)).length;
  const coverage = a.words.length === 0 ? 0 : covered / a.words.length;
  base = base * 0.5 + coverage * 0.5;

  // Distinguishing words only the catalogue item has (e.g. "baby marrow" vs "marrow") lower the score slightly.
  const aSet = new Set(a.words);
  const extra = b.words.filter((w) => !aSet.has(w)).length;
  if (extra > 0) base -= Math.min(0.18, extra * 0.05);

  let packMatch: ScoreResult["packMatch"] = "unknown";
  if (a.pack && b.pack) {
    if (packSizesEqual(a.pack, b.pack)) {
      packMatch = "equal";
      base += 0.1;
    } else {
      packMatch = "different";
      base -= 0.25;
    }
  } else if (a.sizes.length > 0 && b.sizes.length > 0) {
    packMatch = a.sizes.some((s) => b.sizes.includes(s)) ? "equal" : "different";
    base += packMatch === "equal" ? 0.08 : -0.2;
  }

  return { score: Math.max(0, Math.min(1, base)), packMatch };
}
