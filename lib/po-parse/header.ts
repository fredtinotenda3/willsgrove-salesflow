/**
 * Reads the "who / which PO / when / where" facts out of a document's text:
 * PO number, order and delivery dates, the buying customer (several
 * candidates, best first) and delivery address.
 *
 * Works on layout-preserved text (PDF extraction, OCR, pasted tables) as
 * well as plain chat/email messages. Willsgrove's own company block (the
 * "Supplier" on a customer PO) is never returned as the customer.
 */
import { emptyHeader, type ParsedHeader } from "@/lib/po-parse/types";
import { parseDateFromText } from "@/lib/po-parse/units";

const OWN_COMPANY = /willsgrove|wills\s*grove|wilfar/i;
const ORG_WORD =
  /\b(hospital|clinic|pharmacy|supermarkets?|supermarket|stores?|store|hotel|lodge|restaurant|cafe|caf[eé]|bakery|school|college|academy|university|church|ministry|foods?|traders?|trading|wholesalers?|retail(?:ers)?|enterprises?|holdings|investments?|pvt|ltd|limited|\(pvt\)|inc|co\b|company|cc\b|spar|ok\b|choppies|pick\s*n\s*pay|meats?|butchery|farm|market|mart|shop|kitchen|catering|caterers|guest\s*house|resort|lodge|club|centre|center|home)\b/i;
const GENERIC_TITLE = /\b(purchase\s*order|order\s*(form|sheet|list)?|vegetable|fruit|requisition|requisitions?|list|invoice|quotation|delivery\s*note|statement|page|tax)\b/i;

export type Cell = { text: string; start: number; end: number };

/** Splits a layout line into cells separated by 2+ spaces or tabs. */
export function splitCells(line: string): Cell[] {
  const cells: Cell[] = [];
  const re = /\S+(?:[ ]\S+)*/g;
  const expanded = line.replace(/\t/g, "    ");
  let m: RegExpExecArray | null;
  while ((m = re.exec(expanded)) !== null) {
    cells.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return cells;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[\s:.\-–—=>|]+/, "").replace(/[\s:.\-–—,;|]+$/, "").trim();
}

function looksLikeContact(value: string): boolean {
  return /@/.test(value) || /^\+?[\d\s()\-/]{6,}$/.test(value) || /^\d/.test(value) || /^(tel|fax|cell|phone|mobile|whatsapp|email|www)/i.test(value);
}

function plausibleName(value: string): boolean {
  const v = clean(value);
  if (v.length < 3 || v.length > 80) return false;
  if (OWN_COMPANY.test(v)) return false;
  if (looksLikeContact(v)) return false;
  if (/^(n\/a|none|nil|tbc|na)$/i.test(v)) return false;
  if (!/[A-Za-z]{3}/.test(v)) return false;
  return true;
}

function pushUnique(list: string[], value: string) {
  const v = clean(value);
  if (!plausibleName(v)) return;
  if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
}

function findPoNumber(lines: string[]): string | null {
  const patterns: RegExp[] = [
    /(?:purchase\s*order|p\.?\s?o\.?|order)\s*(?:no\.?|number|num|nr|#|ref(?:erence)?)\s*[:#.\-]*\s*([A-Z0-9][A-Z0-9\-/]{2,24})/i,
    /purchase\s*order\s*[:#\-]*\s*([A-Z0-9][A-Z0-9\-/]{2,24})/i,
    /\bP\.?O\.?\s*[#:\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,24})/,
  ];
  for (const pattern of patterns) {
    for (const line of lines) {
      const m = pattern.exec(line);
      const candidate = m?.[1];
      if (candidate && /\d/.test(candidate) && !/^(status|date)$/i.test(candidate)) return candidate;
    }
  }
  return null;
}

function findDates(lines: string[]): { orderDate: string | null; deliveryDate: string | null } {
  let orderDate: string | null = null;
  let deliveryDate: string | null = null;
  let generic: string | null = null;

  for (const line of lines) {
    if (/expected\s*delivery|delivery\s*date|deliver(?:y|ed)?\s*(?:on|by|date)|required\s*(?:by|date|on)|date\s*required|needed\s*(?:by|on)|due\s*(?:date|on)|for\s*delivery\s*on|deliver\s*on/i.test(line)) {
      deliveryDate ??= parseDateFromText(line);
    } else if (/date\s*ordered|order\s*date|po\s*date|date\s*of\s*order|ordered\s*on|order\s*placed/i.test(line)) {
      orderDate ??= parseDateFromText(line);
    } else if (/(^|\s)date\s*[:.\-=]*/i.test(line)) {
      generic ??= parseDateFromText(line);
    }
  }
  return { orderDate: orderDate ?? generic, deliveryDate };
}

function findDeliverTo(lines: string[], names: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const label = /(deliver(?:y)?\s*to|ship(?:ped)?\s*to|delivery\s*address|consignee|deliver\s*at)\s*[:\-.=>]*\s*/i.exec(line);
    if (!label) continue;

    const cells = splitCells(line);
    const labelCell = cells.find((c) => c.start <= label.index + 1 && c.end >= label.index) ?? cells.find((c) => /deliver|ship|consignee/i.test(c.text));
    const col = labelCell ? labelCell.start : label.index;

    const sameLineValue = clean(line.slice(label.index + label[0].length).split(/\s{3,}/)[0] ?? "");
    const blockLines: string[] = [];
    if (sameLineValue && !/^[:\-.]*$/.test(sameLineValue)) blockLines.push(sameLineValue);

    for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
      const labelEnd = labelCell ? labelCell.end : col + 8;
      const cell = splitCells(lines[j]!).find((c) => c.end > col && c.start < labelEnd);
      if (!cell) {
        if (blockLines.length > 0) break;
        continue;
      }
      let text = cell.text;
      // A cell that runs on into the next column ("... Date Ordered  26/11/2026") is cut at the column gap.
      text = text.split(/\s{3,}/)[0]!;
      if (/^(tel|fax|date|order|expected|supplier|item)\b/i.test(text)) break;
      blockLines.push(clean(text));
    }

    const [first, ...rest] = blockLines.filter(Boolean);
    if (first) pushUnique(names, first);
    if (rest.length > 0) {
      const addr = rest.filter((r) => !/^\+?[\d\s()\-/]{6,}$/.test(r)).join(", ");
      if (addr) return addr.slice(0, 480);
    }
  }
  return null;
}

function findLabelled(lines: string[], names: string[]) {
  const re = /^\s*(?:customer(?:\s*name)?|client|buyer|account(?:\s*name)?|bill(?:ed)?\s*to|sold\s*to|ordered\s*by|order\s*from|store|branch|outlet|company|business)\s*[:\-=]+\s*(.+)$/i;
  for (const line of lines) {
    const m = re.exec(line);
    if (m?.[1]) pushUnique(names, m[1].split(/\s{3,}/)[0]!);
  }
}

function findLetterhead(lines: string[], names: string[]) {
  let seen = 0;
  for (const line of lines) {
    const text = clean(line.split(/\s{3,}/)[0] ?? "");
    if (text === "") continue;
    if (++seen > 4) break;
    if (GENERIC_TITLE.test(text) && !ORG_WORD.test(text)) continue;
    if (/\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}/.test(text)) continue;
    if (ORG_WORD.test(text) || (text === text.toUpperCase() && /[A-Z]{3,}\s+[A-Z]{3,}/.test(text) && !GENERIC_TITLE.test(text))) {
      pushUnique(names, text);
    }
  }
}

function findFreeText(lines: string[], names: string[]) {
  const joined = lines.join("\n");
  const intro = /(?:this\s+is|it'?s|my\s+name\s+is|i\s+am|i'm)\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?\s*(?:,|\s)?\s*(?:from|at|of|with)\s+([A-Z][\w &'.\-]{2,50}?)(?=[.,\n!]|\s+(?:please|pls|can|could|we|i)\b|$)/.exec(joined);
  if (intro?.[1]) pushUnique(names, intro[1]);

  const orderFor = /\b(?:order|delivery)\s+(?:for|to)\s+([A-Z][\w &'.\-]{2,50}?)(?=[.,\n!:]|$)/.exec(joined);
  if (orderFor?.[1]) pushUnique(names, orderFor[1]);

  // Signature: lines after "regards / thanks", keeping the one that names an organisation.
  const sig = lines.findIndex((l) => /^\s*(kind\s+)?(regards|thanks|thank\s*you|cheers|best\s*wishes|yours)\b/i.test(l));
  if (sig !== -1) {
    for (const l of lines.slice(sig + 1, sig + 5)) {
      const t = clean(l);
      if (t && ORG_WORD.test(t)) pushUnique(names, t);
    }
  }
}

export function extractHeader(lines: string[]): ParsedHeader {
  const header = emptyHeader();
  const nonEmpty = lines.filter((l) => l.trim() !== "");

  header.poNumber = findPoNumber(nonEmpty);
  const { orderDate, deliveryDate } = findDates(nonEmpty);
  header.orderDate = orderDate;
  header.requestedDeliveryDate = deliveryDate;

  const names: string[] = [];
  findLabelled(nonEmpty, names);
  header.deliveryAddress = findDeliverTo(nonEmpty, names);
  findLetterhead(nonEmpty, names);
  findFreeText(nonEmpty, names);
  header.customerNameCandidates = names.slice(0, 5);

  const text = nonEmpty.join("\n");
  if (/\b(zwg|zig|zwl)\b/i.test(text)) header.currency = "ZWG";
  else if (/\busd\b|us\s?\$|\$\s?\d/i.test(text)) header.currency = "USD";

  return header;
}
