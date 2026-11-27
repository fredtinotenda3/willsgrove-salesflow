/**
 * Units, quantities, pack sizes and dates as customers actually write them.
 * Pure functions, no I/O, so every rule here is unit-tested.
 *
 * Canonical unit codes returned (these are what the order form's Unit box
 * holds; the catalogue's own unitOfMeasure still wins when a product is
 * matched -- see lib/po-parse/resolve.ts):
 *   KG G ML L EA PNT PKT BOX BAG BUNCH HEAD DOZ TRAY CRATE CTN TUB BTL
 */

export type UnitCode = "KG" | "G" | "ML" | "L" | "EA" | "PNT" | "PKT" | "BOX" | "BAG" | "BUNCH" | "HEAD" | "DOZ" | "TRAY" | "CRATE" | "CTN" | "TUB" | "BTL";

const UNIT_ALIASES: Record<string, UnitCode> = {
  kg: "KG", kgs: "KG", kgm: "KG", kilo: "KG", kilos: "KG", kilogram: "KG", kilograms: "KG", "kg's": "KG",
  g: "G", gm: "G", gms: "G", gr: "G", grm: "G", gram: "G", grams: "G",
  ml: "ML", mls: "ML", millilitre: "ML", milliliter: "ML",
  l: "L", lt: "L", ltr: "L", ltrs: "L", litre: "L", litres: "L", liter: "L", liters: "L",
  ea: "EA", each: "EA", pc: "EA", pcs: "EA", piece: "EA", pieces: "EA", unit: "EA", units: "EA", single: "EA", singles: "EA", ones: "EA",
  pnt: "PNT", pnts: "PNT", pnp: "PNT", pnnet: "PNT", punnet: "PNT", punnets: "PNT", punet: "PNT", punnett: "PNT", pun: "PNT",
  pkt: "PKT", pkts: "PKT", pk: "PKT", pks: "PKT", pack: "PKT", packs: "PKT", packet: "PKT", packets: "PKT", pkg: "PKT", sachet: "PKT", sachets: "PKT", satchet: "PKT", satchets: "PKT",
  box: "BOX", boxes: "BOX", bx: "BOX", bxs: "BOX",
  bag: "BAG", bags: "BAG", sack: "BAG", sacks: "BAG",
  bunch: "BUNCH", bunches: "BUNCH", bundle: "BUNCH", bundles: "BUNCH", bndl: "BUNCH", bunc: "BUNCH",
  head: "HEAD", heads: "HEAD", hd: "HEAD", hds: "HEAD",
  doz: "DOZ", dozen: "DOZ", dozens: "DOZ",
  tray: "TRAY", trays: "TRAY",
  crate: "CRATE", crates: "CRATE",
  ctn: "CTN", ctns: "CTN", carton: "CTN", cartons: "CTN", case: "CTN", cases: "CTN",
  tub: "TUB", tubs: "TUB",
  btl: "BTL", btls: "BTL", bottle: "BTL", bottles: "BTL",
};

/** All words that can act as a unit in free text. */
export const UNIT_WORD_PATTERN = Object.keys(UNIT_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/[.*+?^${}()|[\]\\']/g, "\\$&"))
  .join("|");

export function canonicalUnit(raw: string | null | undefined): UnitCode | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[key] ?? null;
}

export function isMeasureUnit(unit: UnitCode | null): boolean {
  return unit === "KG" || unit === "G" || unit === "ML" || unit === "L";
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, half: 0.5, quarter: 0.25, couple: 2, pair: 2,
};

export const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).filter((w) => w !== "a" && w !== "an").join("|");

export function numberWordValue(word: string): number | null {
  const v = NUMBER_WORDS[word.trim().toLowerCase()];
  return v === undefined ? null : v;
}

/** "2,5" -> 2.5 ; "1,250" -> 1250 ; "1 250" -> 1250 ; "1/2" -> 0.5 ; "1½" -> 1.5 */
export function parseQuantityNumber(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, " ");
  if (s === "") return null;
  const halves: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  const mixed = /^(\d+)?\s*([½¼¾])$/.exec(s);
  if (mixed) return Number(mixed[1] ?? 0) + halves[mixed[2]!]!;
  const frac = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) {
    const d = Number(frac[3]);
    if (d === 0) return null;
    return Number(frac[1] ?? 0) + Number(frac[2]) / d;
  }
  if (/^\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/[ ,]/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else if (/^\d+,\d{3}$/.test(s)) s = s.replace(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Decimal string with up to 4 places, no trailing zeros; null if not > 0. */
export function toDecimalString(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0 || value > 99_999_999_999_999) return null;
  const fixed = Number(value.toFixed(4));
  if (fixed <= 0) return null;
  return String(fixed);
}

// ---------------------------------------------------------------------------
// Pack sizes
// ---------------------------------------------------------------------------

export type PackSize =
  | { kind: "weight"; grams: number; label: string }
  | { kind: "volume"; ml: number; label: string }
  | { kind: "count"; count: number; label: string }
  | { kind: "multipack"; n: number; grams: number; label: string };

const WEIGHT_RE = /(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|gm|gms|grams?|g)\b/i;
const VOLUME_RE = /(\d+(?:[.,]\d+)?)\s*(mls?|ltrs?|litres?|liters?|lt|l)\b/i;
const COUNT_RE = /\b(\d{1,3})\s*(?:'?s)\b/i; // 6s, 6's
const MULTI_RE = /(\d{1,3})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kgs?|g|gm|ml|l)\b/i;

function gramsOf(value: number, unit: string): number {
  return /^k/i.test(unit) ? value * 1000 : value;
}

export function parsePackSize(text: string): PackSize | null {
  const multi = MULTI_RE.exec(text);
  if (multi) {
    const per = parseQuantityNumber(multi[2]!);
    if (per !== null && /^(kgs?|g|gm)$/i.test(multi[3]!)) {
      return { kind: "multipack", n: Number(multi[1]), grams: gramsOf(per, multi[3]!), label: `${multi[1]}x${multi[2]}${multi[3]!.toUpperCase()}` };
    }
  }
  const weight = WEIGHT_RE.exec(text);
  if (weight) {
    const v = parseQuantityNumber(weight[1]!);
    if (v !== null) return { kind: "weight", grams: gramsOf(v, weight[2]!), label: `${weight[1]}${/^k/i.test(weight[2]!) ? "KG" : "G"}` };
  }
  const volume = VOLUME_RE.exec(text);
  if (volume) {
    const v = parseQuantityNumber(volume[1]!);
    if (v !== null) {
      const ml = /^(l|lt|ltrs?|litres?|liters?)$/i.test(volume[2]!) ? v * 1000 : v;
      return { kind: "volume", ml, label: `${volume[1]}${/^m/i.test(volume[2]!) ? "ML" : "L"}` };
    }
  }
  const count = COUNT_RE.exec(text);
  if (count) return { kind: "count", count: Number(count[1]), label: `${count[1]}S` };
  return null;
}

export function packSizesEqual(a: PackSize, b: PackSize): boolean {
  if (a.kind !== b.kind) {
    // 8x1.5kg and 1.5kg describe the same retail pack for matching purposes
    if (a.kind === "multipack" && b.kind === "weight") return Math.abs(a.grams - b.grams) < 1;
    if (b.kind === "multipack" && a.kind === "weight") return Math.abs(b.grams - a.grams) < 1;
    return false;
  }
  switch (a.kind) {
    case "weight":
      return Math.abs(a.grams - (b as typeof a).grams) < 1;
    case "volume":
      return Math.abs(a.ml - (b as typeof a).ml) < 1;
    case "count":
      return a.count === (b as typeof a).count;
    case "multipack":
      return a.n === (b as typeof a).n && Math.abs(a.grams - (b as typeof a).grams) < 1;
  }
}

// ---------------------------------------------------------------------------
// Dates (day-first: Zimbabwe / UK convention)
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/** Returns the FIRST valid date in `text` as YYYY-MM-DD, day-first. */
export function parseDateFromText(text: string): string | null {
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) {
    const r = validYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (r) return r;
  }
  const numeric = /\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2}|\d{4})\b/.exec(text);
  if (numeric) {
    const r = validYmd(fullYear(Number(numeric[3])), Number(numeric[2]), Number(numeric[1]));
    if (r) return r;
  }
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s*(\d{2,4})?\b/i.exec(text);
  if (named) {
    const month = MONTHS[named[2]!.toLowerCase()];
    const year = named[3] ? fullYear(Number(named[3])) : new Date().getUTCFullYear();
    if (month) {
      const r = validYmd(year, month, Number(named[1]));
      if (r) return r;
    }
  }
  const usNamed = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text);
  if (usNamed) {
    const month = MONTHS[usNamed[1]!.toLowerCase()];
    if (month) {
      const r = validYmd(Number(usNamed[3]), month, Number(usNamed[2]));
      if (r) return r;
    }
  }
  return null;
}
