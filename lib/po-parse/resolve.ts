/**
 * Turns parsed PO text into "ready to review" order data by matching it
 * against the live database: which Customer is this, and which catalogue
 * Product is each line. Never writes anything.
 *
 * Order of trust for each line:
 *   1. a confirmed ProductAlias (human-approved earlier)        -> confidence 1
 *   2. the customer's own item code equals a SAP code            -> 0.98
 *   3. scored text match (lib/matching/product-scorer.ts)        -> pre-selected only when clear
 * Anything less than clear is returned as suggestions for the user to pick.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { lookupCustomerAlias, lookupProductAlias } from "@/lib/matching/aliases";
import { scoreProductMatch, scoreTokens } from "@/lib/matching/product-scorer";
import { normalizeMatchText } from "@/lib/matching/normalize";
import { customerTokens, scoreCustomerName } from "@/lib/po-parse/customer-score";
import type { ParsedHeader, ParsedLine } from "@/lib/po-parse/types";
import { parsePackSize, packSizesEqual, toDecimalString } from "@/lib/po-parse/units";

const PRODUCT_CONFIDENT = 0.68;
const PRODUCT_GAP = 0.08;
const MAX_SUGGESTIONS = 5;
const DB_POOL_PER_LINE = 80;

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export type CustomerCandidate = { id: string; name: string; sapCustomerCode: string | null; storeCode: string | null; score: number };

export type CustomerResolution =
  | { status: "matched"; customer: CustomerCandidate; matchedOn: string; note: string | null; alternatives: CustomerCandidate[] }
  | { status: "ambiguous"; searchedFor: string[]; candidates: CustomerCandidate[] }
  | { status: "not_found"; searchedFor: string[] };

export async function resolveCustomer(header: ParsedHeader): Promise<CustomerResolution> {
  const searched = header.customerNameCandidates.filter((n) => n.trim() !== "");
  if (searched.length === 0) return { status: "not_found", searchedFor: [] };

  for (const name of searched) {
    const alias = await lookupCustomerAlias(name);
    if (alias) {
      const c = await prisma.customer.findUnique({ where: { id: alias.customerId }, select: { id: true, name: true, sapCustomerCode: true, storeCode: true, status: true } });
      if (c && c.status === "ACTIVE") return { status: "matched", customer: { ...c, score: 1 }, matchedOn: name, note: null, alternatives: [] };
    }
  }

  const tokenSet = new Set<string>();
  for (const name of searched) for (const t of customerTokens(name)) tokenSet.add(t);
  if (tokenSet.size === 0) return { status: "not_found", searchedFor: searched };

  const rows = await prisma.customer.findMany({
    where: { status: "ACTIVE", OR: [...tokenSet].map((t) => ({ name: { contains: t, mode: "insensitive" as const } })) },
    select: { id: true, name: true, sapCustomerCode: true, storeCode: true },
    take: 400,
  });

  const scored = new Map<string, CustomerCandidate & { via: string }>();
  for (const row of rows) {
    for (const name of searched) {
      const score = scoreCustomerName(name, row.name);
      const prev = scored.get(row.id);
      if (score > 0 && (!prev || score > prev.score)) scored.set(row.id, { ...row, score, via: name });
    }
  }
  const ranked = [...scored.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (ranked.length === 0 || ranked[0]!.score < 0.45) return { status: "not_found", searchedFor: searched };

  const top = ranked[0]!;
  const sameBest = ranked.filter((r) => Math.abs(r.score - top.score) < 0.02);
  const distinctNames = new Set(sameBest.map((r) => normalizeMatchText(r.name)));
  const queryTokens = customerTokens(top.via);

  // Several records with the very same name (SAP keeps duplicate BP codes): one business, pick the first and say so.
  if (sameBest.length > 1 && distinctNames.size === 1 && top.score >= 0.6) {
    const sorted = [...sameBest].sort((a, b) => (a.sapCustomerCode ?? "").localeCompare(b.sapCustomerCode ?? ""));
    return {
      status: "matched",
      customer: sorted[0]!,
      matchedOn: top.via,
      note: `${sameBest.length} customer records share this name -- ${sorted[0]!.sapCustomerCode ?? "the first"} was chosen. Change it if another account applies.`,
      alternatives: sorted.slice(1, MAX_SUGGESTIONS),
    };
  }

  const second = ranked.find((r) => normalizeMatchText(r.name) !== normalizeMatchText(top.name));
  const clear = top.score >= 0.75 && (!second || top.score - second.score >= 0.15) && (queryTokens.length >= 2 || !second);
  if (clear) {
    return { status: "matched", customer: top, matchedOn: top.via, note: null, alternatives: ranked.slice(1, MAX_SUGGESTIONS) };
  }
  return { status: "ambiguous", searchedFor: searched, candidates: ranked.slice(0, 8) };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type ProductSuggestionOut = {
  id: string;
  sapItemCode: string;
  itemName: string;
  unitOfMeasure: string | null;
  packSize: string | null;
  score: number;
};

export type ResolvedLine = ParsedLine & {
  matched: ProductSuggestionOut | null;
  matchSource: "ALIAS" | "CODE" | "TEXT" | "NONE";
  matchScore: number | null;
  suggestions: ProductSuggestionOut[];
  /** Final values the form should show. */
  finalQuantity: string | null;
  finalUnit: string | null;
};

function dbFilterTerms(description: string): string[] {
  const t = scoreTokens(description);
  const terms = new Set<string>();
  for (const w of t.words) {
    if (w.length < 3) continue;
    terms.add(w.length > 6 ? w.slice(0, w.length - 2) : w);
    if (w.endsWith("berry")) terms.add("berr");
    if (w === "paw") terms.add("paw");
  }
  for (const raw of normalizeMatchText(description).split(" ")) {
    if (raw.length >= 4 && !/\d/.test(raw)) terms.add(raw.length > 6 ? raw.slice(0, raw.length - 2) : raw);
  }
  return [...terms].slice(0, 8);
}

type Pool = Array<{ id: string; sapItemCode: string; itemName: string; unitOfMeasure: string | null; packSize: string | null }>;

async function candidatePool(description: string): Promise<Pool> {
  const terms = dbFilterTerms(description);
  if (terms.length === 0) return [];
  return prisma.product.findMany({
    where: { status: "ACTIVE", OR: terms.map((term) => ({ itemName: { contains: term, mode: "insensitive" as const } })) },
    select: { id: true, sapItemCode: true, itemName: true, unitOfMeasure: true, packSize: true },
    take: DB_POOL_PER_LINE,
    orderBy: { itemName: "asc" },
  });
}

async function resolveOne(line: ParsedLine, customerId: string | null): Promise<ResolvedLine> {
  const base = { ...line, matched: null as ProductSuggestionOut | null, matchSource: "NONE" as ResolvedLine["matchSource"], matchScore: null as number | null, suggestions: [] as ProductSuggestionOut[] };

  let alias: Awaited<ReturnType<typeof lookupProductAlias>> = null;
  try {
    alias = await lookupProductAlias(line.description, customerId);
    if (!alias && line.rawText !== line.description) alias = await lookupProductAlias(line.rawText, customerId);
  } catch {
    alias = null;
  }
  if (alias) {
    const p = await prisma.product.findUnique({ where: { id: alias.productId }, select: { id: true, sapItemCode: true, itemName: true, unitOfMeasure: true, packSize: true } });
    if (p) {
      const out = { ...p, score: 1 };
      return finalise({ ...base, matched: out, matchSource: "ALIAS", matchScore: 1, suggestions: [out] });
    }
  }

  const pool = await candidatePool(line.description);
  const aTokens = scoreTokens(`${line.description}`);
  const scored = pool
    .map((p) => {
      const r = scoreProductMatch(aTokens, p.itemName, undefined, { wrote: line.customerItemCode, candidateCode: p.sapItemCode });
      return { p, score: r.score, packMatch: r.packMatch };
    })
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score || a.p.itemName.length - b.p.itemName.length);

  const suggestions: ProductSuggestionOut[] = scored.slice(0, MAX_SUGGESTIONS).map(({ p, score }) => ({ ...p, score: Number(score.toFixed(3)) }));
  const top = scored[0];
  const second = scored[1];
  const confident = !!top && top.score >= PRODUCT_CONFIDENT && (!second || top.score - second.score >= PRODUCT_GAP);

  if (confident && top) {
    const out = suggestions[0]!;
    return finalise({ ...base, matched: out, matchSource: line.customerItemCode && out.sapItemCode === line.customerItemCode ? "CODE" : "TEXT", matchScore: out.score, suggestions });
  }
  return finalise({ ...base, matchSource: "NONE", matchScore: top ? Number(top.score.toFixed(3)) : null, suggestions });
}

/** Chooses the quantity/unit shown in the form. The PO's own words win; the catalogue fills gaps. */
function finalise(r: Omit<ResolvedLine, "finalQuantity" | "finalUnit">): ResolvedLine {
  let qty = r.quantity;
  let unit = r.unit;
  const warnings = [...r.warnings];

  if (r.matched) {
    const productUnit = r.matched.unitOfMeasure;
    if (r.measureOnly) {
      // "Mangoes 2.5kg": was that 2.5 kg of loose mangoes, or one 2.5 kg pack?
      const wrote = parsePackSize(r.description);
      const have = r.matched.packSize ? parsePackSize(r.matched.packSize) : parsePackSize(r.matched.itemName);
      if (wrote && have && packSizesEqual(wrote, have) && productUnit && productUnit.toUpperCase() !== "KG") {
        qty = "1";
        unit = productUnit;
        const idx = warnings.findIndex((w) => w.startsWith("Only a weight"));
        if (idx !== -1) warnings.splice(idx, 1);
        warnings.push(`Read "${r.description}" as 1 x ${r.matched.itemName}. Change the quantity if you meant more.`);
      }
    }
    if (!unit && productUnit) unit = productUnit;
    // The catalogue sells this item in a different unit than the PO wrote (e.g. PO "PNT", catalogue "KG").
    if (unit && productUnit && unit.toUpperCase() !== productUnit.toUpperCase() && !r.measureOnly) {
      warnings.push(`PO unit ${unit} differs from the catalogue unit ${productUnit} -- check.`);
    }
  }
  if (!r.matched) warnings.push(r.suggestions.length > 0 ? "No exact product match -- pick one of the suggestions or search the catalogue." : "No matching product found in the catalogue.");

  return { ...r, warnings, finalQuantity: qty, finalUnit: unit };
}

export async function resolveLines(lines: ParsedLine[], customerId: string | null): Promise<ResolvedLine[]> {
  const out: ResolvedLine[] = [];
  const CHUNK = 8;
  for (let i = 0; i < lines.length; i += CHUNK) {
    out.push(...(await Promise.all(lines.slice(i, i + CHUNK).map((l) => resolveOne(l, customerId)))));
  }
  return out.map((l) => ({ ...l, finalQuantity: toDecimalString(Number(l.finalQuantity)) }));
}
