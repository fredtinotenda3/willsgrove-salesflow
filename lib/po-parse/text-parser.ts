/**
 * Free-text order lines as customers type them in WhatsApp / email:
 *
 *   blueberries 125 x 14        -> blueberries 125g, qty 14
 *   Brinjals also x 2 punnets   -> Brinjals, qty 2, PNT
 *   2kg onions white            -> onions white, qty 2, KG
 *   Mangoes 2.5kg               -> Mangoes, 2.5 KG (measure only)
 *   a dozen eggs / two kg tomatoes / 10 x apples / apples (10)
 *
 * Nothing is invented: when the text states no quantity the line is kept
 * with quantity null and a warning, never a guess.
 */
import type { ParsedLine } from "@/lib/po-parse/types";
import {
  UNIT_WORD_PATTERN,
  NUMBER_WORD_PATTERN,
  canonicalUnit,
  isMeasureUnit,
  numberWordValue,
  parsePackSize,
  parseQuantityNumber,
  toDecimalString,
  type UnitCode,
} from "@/lib/po-parse/units";

const NUM = String.raw`(?:\d+\s?[½¼¾]|\d+(?:[.,]\d+)?|[½¼¾]|\d+\s*\/\s*\d+)`;
const UNITW = `(?:${UNIT_WORD_PATTERN})`;

const FILLER_EDGE = /^(?:please|pls|plz|kindly|also|and|then|plus|need|needs|want|get|order|send|bring|can\s+i\s+(?:have|get)|i\s+(?:need|want)|we\s+(?:need|want)|of)\b[\s,:-]*/i;
const FILLER_TAIL = /[\s,:-]*\b(?:please|pls|plz|thanks|thank\s*you|also|too|as\s+well)\.?$/i;

type RawParse = {
  description: string;
  quantity: number | null;
  unit: UnitCode | null;
  measureOnly: boolean;
  warnings: string[];
  confidence: number;
};

function cleanDescription(value: string): string {
  let v = value.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const before = v;
    v = v.replace(FILLER_EDGE, "").replace(FILLER_TAIL, "").trim();
    if (v === before) break;
  }
  return v.replace(/^[\s:.\-–—=,;|*•·>]+/, "").replace(/[\s:.\-–—=,;|*]+$/, "").trim();
}

/** A bare number that is almost certainly a pack size in grams ("blueberries 125"). */
function looksLikeBareGrams(n: number): boolean {
  return n >= 100 && n <= 2000 && n % 25 === 0;
}

function inferUnitFromDescription(description: string): UnitCode | null {
  if (/\b(p\/?kg|per\s*kg|\/\s*kg|perkg)\b/i.test(description)) return "KG";
  if (/\bkg\b/i.test(description) && !/\d\s*kg/i.test(description)) return "KG";
  if (/\b(pnt|pnp|punnets?)\b/i.test(description)) return "PNT";
  if (/\b(each|ea)\b/i.test(description)) return "EA";
  if (/\bheads?\b/i.test(description)) return "HEAD";
  if (/\b(bunch(?:es)?|bundles?)\b/i.test(description)) return "BUNCH";
  return null;
}

export function parseItemText(input: string): RawParse | null {
  const text = input.trim();
  if (text === "") return null;
  const warnings: string[] = [];

  // "Apples (10)" / "Apples (10 kg)"
  const paren = new RegExp(`^(.*?\\S)\\s*\\(\\s*(${NUM})\\s*(${UNITW})?\\s*\\)$`, "i").exec(text);
  if (paren) {
    const q = parseQuantityNumber(paren[2]!);
    if (q !== null) {
      const unit = canonicalUnit(paren[3]);
      return { description: cleanDescription(paren[1]!), quantity: q, unit, measureOnly: false, warnings, confidence: 0.75 };
    }
  }

  // A) trailing multiplier: "... x 14", "... x2", "... also x 2 punnets"
  const trailingMul = new RegExp(`^(.*?\\S)\\s*(?:\\balso\\b\\s*)?(?:^|(?<=[\\s\\d)]))[xX×*]\\s*(${NUM})\\s*(${UNITW})?\\.?\\s*$`).exec(text);
  if (trailingMul) {
    const q = parseQuantityNumber(trailingMul[2]!);
    if (q !== null && q > 0) {
      let description = trailingMul[1]!;
      const unit = canonicalUnit(trailingMul[3]);
      // "Blueberries 125 x 14": a bare 100..2000 number before the multiplier is the pack size in grams.
      const bare = /^(.*?[A-Za-z)])\s+(\d{2,4})$/.exec(description);
      if (bare && looksLikeBareGrams(Number(bare[2]))) {
        description = `${bare[1]} ${bare[2]}g`;
      }
      if (unit === null && /^(?:punnets?|pnts?|pkts?|packs?|boxes|box|bags?|heads?|bunch(?:es)?)\s+of\s+/i.test(description)) {
        // "x 3 punnets of strawberries" handled by C; nothing to do here
      }
      return { description: cleanDescription(description), quantity: q, unit, measureOnly: false, warnings, confidence: 0.92 };
    }
  }

  // B) leading multiplier: "10 x apples", "2 x 5kg onions"
  const leadingMul = new RegExp(`^(${NUM})\\s*[xX×]\\s*(?:(${UNITW})\\s+(?:of\\s+)?)?(.+)$`, "i").exec(text);
  if (leadingMul) {
    const q = parseQuantityNumber(leadingMul[1]!);
    if (q !== null && q > 0 && /[A-Za-z]{2}/.test(leadingMul[3]!)) {
      return { description: cleanDescription(leadingMul[3]!), quantity: q, unit: canonicalUnit(leadingMul[2]), measureOnly: false, warnings, confidence: 0.9 };
    }
  }

  // half a kg / half kg of mangoes
  const half = /^(?:a\s+)?(half|quarter)\s+(?:a\s+)?(kg|kilo|kgs|kilos)\s+(?:of\s+)?(.+)$/i.exec(text);
  if (half) {
    return { description: cleanDescription(half[3]!), quantity: half[1]!.toLowerCase() === "half" ? 0.5 : 0.25, unit: "KG", measureOnly: false, warnings, confidence: 0.8 };
  }

  // G) number words: "two kg tomatoes", "a dozen eggs", "three punnets blueberries"
  const wordLead = new RegExp(`^(${NUMBER_WORD_PATTERN}|a|an)\\s+(?:(${UNITW})\\s+(?:of\\s+)?)?(.+)$`, "i").exec(text);
  if (wordLead) {
    const n = numberWordValue(wordLead[1]!);
    const unit = canonicalUnit(wordLead[2]);
    // "a" / "an" alone is only a quantity when a unit follows ("a dozen eggs", "a kg of mangoes").
    const isArticle = /^(a|an)$/i.test(wordLead[1]!);
    if (n !== null && (!isArticle || unit !== null) && /[A-Za-z]{2}/.test(wordLead[3]!)) {
      return { description: cleanDescription(wordLead[3]!), quantity: n, unit, measureOnly: false, warnings, confidence: 0.75 };
    }
  }
  // "dozen eggs"
  const dozen = /^(dozen)\s+(?:of\s+)?(.+)$/i.exec(text);
  if (dozen) {
    return { description: cleanDescription(dozen[2]!), quantity: 1, unit: "DOZ", measureOnly: false, warnings, confidence: 0.7 };
  }

  // C) leading quantity + unit: "2kg onions white", "5 pnts blueberries", "3 boxes tomatoes"
  const leadingUnit = new RegExp(`^(${NUM})\\s*(${UNITW})\\b\\.?\\s*(?:of\\s+)?(.+)$`, "i").exec(text);
  if (leadingUnit) {
    const q = parseQuantityNumber(leadingUnit[1]!);
    const unit = canonicalUnit(leadingUnit[2]);
    if (q !== null && q > 0 && unit !== null && /[A-Za-z]{2}/.test(leadingUnit[3]!)) {
      return { description: cleanDescription(leadingUnit[3]!), quantity: q, unit, measureOnly: false, warnings, confidence: 0.88 };
    }
  }

  // D) trailing quantity + unit: "Mangoes 2.5kg", "Brinjals 2 punnets", "cauliflower 3 heads"
  const trailingUnit = new RegExp(`^(.*?[A-Za-z)])\\s*[-:=]?\\s*(${NUM})\\s*(${UNITW})\\.?\\s*$`, "i").exec(text);
  if (trailingUnit) {
    const q = parseQuantityNumber(trailingUnit[2]!);
    const unit = canonicalUnit(trailingUnit[3]);
    if (q !== null && q > 0 && unit !== null) {
      const measure = isMeasureUnit(unit);
      if (measure) {
        warnings.push("Only a weight/size was written (no pack count) -- confirm the quantity.");
      }
      return {
        description: cleanDescription(measure ? `${trailingUnit[1]} ${trailingUnit[2]}${unit === "KG" ? "kg" : unit === "G" ? "g" : unit.toLowerCase()}` : trailingUnit[1]!),
        quantity: q,
        unit,
        measureOnly: measure,
        warnings,
        confidence: measure ? 0.55 : 0.85,
      };
    }
  }

  // E) trailing bare number: "Apples 10", "Apples - 10", "blueberries 125"
  const trailingBare = new RegExp(`^(.*?[A-Za-z)])\\s*[-:=–]?\\s*(${NUM})\\s*$`).exec(text);
  if (trailingBare) {
    const q = parseQuantityNumber(trailingBare[2]!);
    if (q !== null && q > 0) {
      if (looksLikeBareGrams(q)) {
        warnings.push("Only a size was written (no quantity) -- please enter the quantity.");
        return { description: cleanDescription(`${trailingBare[1]} ${trailingBare[2]}g`), quantity: null, unit: null, measureOnly: false, warnings, confidence: 0.3 };
      }
      return { description: cleanDescription(trailingBare[1]!), quantity: q, unit: null, measureOnly: false, warnings, confidence: 0.7 };
    }
  }

  // F) leading bare number: "10 apples"
  const leadingBare = new RegExp(`^(${NUM})\\s+(.+)$`).exec(text);
  if (leadingBare) {
    const q = parseQuantityNumber(leadingBare[1]!);
    if (q !== null && q > 0 && /[A-Za-z]{2}/.test(leadingBare[2]!)) {
      return { description: cleanDescription(leadingBare[2]!), quantity: q, unit: null, measureOnly: false, warnings, confidence: 0.7 };
    }
  }

  // No quantity written.
  const description = cleanDescription(text);
  if (!/[A-Za-z]{2}/.test(description)) return null;
  warnings.push("No quantity was written for this line.");
  return { description, quantity: null, unit: null, measureOnly: false, warnings, confidence: 0.3 };
}

// ---------------------------------------------------------------------------
// Line-level helpers
// ---------------------------------------------------------------------------

const CHAT_PREFIX = /^\s*\[?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?\]?\s*(?:-\s*)?[^:]{1,40}:\s*/;
const LIST_MARKER = /^\s*(?:[-*•·>●▪]+|\(?\d{1,3}[.)])\s+(?=\S)/;

const NOISE_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|hallo|howzit|dear|good\s*(?:morning|afternoon|evening|day)|morning|afternoon|evening|team)\b[^\d]*$/i,
  /^(?:thanks?|thank\s*you|regards|kind\s*regards|best\s*regards|cheers|sent\s*from|many\s*thanks|appreciated?|yours|sincerely|ok|okay|noted|please\s*confirm|pls\s*confirm|confirm)\b[^\d]*$/i,
  /\b(?:deliver(?:y|ed)?|date|po\s*(?:no|number|#)|order\s*(?:no|number|#|status|date)|purchase\s*order|tel|fax|phone|cell|mobile|whatsapp|e-?mail|www\.|address|total|vat|subtotal|signature|signed|invoice|account|supplier|page\s*\d|requested\s*by|authori[sz]ed)\b/i,
  /@|https?:\/\//i,
  /^\s*(?:from|to|cc|subject|sent|date)\s*:/i,
];

function isNoiseLine(line: string): boolean {
  const hasQuantitySignal = /\d/.test(line) || new RegExp(`\\b(?:${NUMBER_WORD_PATTERN}|dozen)\\b`, "i").test(line);
  for (const [i, pattern] of NOISE_PATTERNS.entries()) {
    if (i === 0 || i === 1) {
      if (pattern.test(line) && !hasQuantitySignal) return true;
      continue;
    }
    if (pattern.test(line)) return true;
  }
  return false;
}

/** "tomatoes 5kg, onions 3kg; potatoes 10kg" -> three items. Only splits when every part carries a quantity cue. */
function splitMultiItem(line: string): string[] {
  const bySemi = line.split(/\s*;\s*/).filter(Boolean);
  const parts = bySemi.flatMap((chunk) => {
    const commas = chunk.split(/\s*,\s+(?=[A-Za-z0-9½¼¾])/).filter(Boolean);
    if (commas.length >= 2 && commas.every((c) => /\d/.test(c) || /\b(dozen|half)\b/i.test(c))) return commas;
    return [chunk];
  });
  return parts.length > 0 ? parts : [line];
}

export type FreeTextResult = { lines: ParsedLine[]; skipped: string[] };

export function parseFreeText(text: string): FreeTextResult {
  const rawLines = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ ​‎‏]/g, " ")
    .split("\n");

  type Candidate = { raw: string };
  const candidates: Candidate[] = [];
  const skipped: string[] = [];

  for (const original of rawLines) {
    let line = original.replace(/^\s*>+\s?/, "").replace(CHAT_PREFIX, "").replace(LIST_MARKER, "").trim();
    if (line === "") continue;
    if (/^[-=_*~.\s]{3,}$/.test(line)) continue;
    if (isNoiseLine(line)) {
      skipped.push(original.trim());
      continue;
    }
    for (const part of splitMultiItem(line)) {
      const piece = part.trim();
      if (piece !== "") candidates.push({ raw: piece });
    }
    line = "";
  }

  const parsed = candidates.map((c) => ({ raw: c.raw, parse: parseItemText(c.raw) }));
  const withQty = parsed.filter((p) => p.parse && p.parse.quantity !== null).length;

  const lines: ParsedLine[] = [];
  for (const { raw, parse } of parsed) {
    if (!parse) {
      skipped.push(raw);
      continue;
    }
    // A line with no quantity is only plausibly a product when it sits among real order lines and is short.
    if (parse.quantity === null && !(withQty >= 2 && parse.description.split(/\s+/).length <= 5 && !/[.!?]$/.test(raw) && !/\d/.test(raw))) {
      if (!(parse.measureOnly || /\d/.test(raw))) {
        skipped.push(raw);
        continue;
      }
    }

    const pack = parsePackSize(parse.description);
    const unit = parse.unit ?? inferUnitFromDescription(parse.description);
    lines.push({
      lineNumber: lines.length + 1,
      rawText: raw,
      description: parse.description,
      quantity: toDecimalString(parse.quantity),
      unit,
      packSize: pack ? pack.label : null,
      measureOnly: parse.measureOnly,
      unitPrice: null,
      customerItemCode: null,
      confidence: parse.confidence,
      warnings: parse.warnings,
    });
  }

  return { lines, skipped };
}
