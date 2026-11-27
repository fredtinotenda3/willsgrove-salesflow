/**
 * Dependency-free PDF text extraction with layout preserved.
 *
 * Why this exists: most purchase orders emailed to Willsgrove are generated
 * PDFs (Crystal Reports, SAP, Excel "print to PDF", Word) that carry a real
 * text layer. Reading that layer is exact, instant, free and needs no AI
 * provider -- so it is tried first, and only scanned/photographed PDFs
 * (no text layer) fall through to a vision model.
 *
 * Scope (deliberately honest, not a general PDF renderer):
 *  - classic xref tables and PDF 1.5 object streams / xref streams
 *  - FlateDecode / ASCIIHex / ASCII85 filters (what real generators use)
 *  - simple fonts (WinAnsi/MacRoman/Differences) and Type0/Identity-H fonts
 *    WITH a ToUnicode CMap
 *  - Td, TD, Tm, T-star, quote operators, Tj and TJ with the CTM and text matrix, so text is placed by
 *    its real coordinates, grouped into lines, and columns are kept apart
 *    with runs of spaces (the same idea as `pdftotext -layout`).
 * Anything it cannot decode (encrypted file, CID fonts without ToUnicode,
 * pure image scans) yields an empty/!ok result so the caller can fall back
 * instead of returning garbage.
 */
import { inflateSync, inflateRawSync } from "node:zlib";

export type PdfTextResult =
  | { ok: true; pages: string[][]; text: string; charCount: number }
  | { ok: false; reason: "encrypted" | "not-pdf" | "unreadable"; message: string };

type PdfObject = { dict: string; stream: Buffer | null };
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_OBJECT_BYTES = 40 * 1024 * 1024;
const AVG_CHAR_PTS = 4.5;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function multiply(m: Matrix, n: Matrix): Matrix {
  // result = m x n (apply m first, then n) -- PDF row-vector convention
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function skipBalanced(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "(") {
      // skip literal string
      i = skipLiteralString(text, i) - 1;
      continue;
    }
    if (text.startsWith(open, i)) {
      depth++;
      i += open.length - 1;
    } else if (text.startsWith(close, i)) {
      depth--;
      i += close.length - 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

function skipLiteralString(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Returns the raw value token that follows `/Key` in a dictionary string. */
function dictGet(dict: string, key: string): string | null {
  const re = new RegExp(`/${key}(?![A-Za-z0-9_.#-])`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(dict)) !== null) {
    // Only consider top-level keys (depth 0 inside the outermost <<>>).
    if (nestingDepth(dict, match.index) > 1) continue;
    let i = match.index + match[0].length;
    while (i < dict.length && /\s/.test(dict[i]!)) i++;
    if (dict.startsWith("<<", i)) return dict.slice(i, skipBalanced(dict, i, "<<", ">>"));
    if (dict[i] === "[") return dict.slice(i, skipBalanced(dict, i, "[", "]"));
    if (dict[i] === "(") return dict.slice(i, skipLiteralString(dict, i));
    const rest = dict.slice(i);
    const ref = /^(\d+)\s+(\d+)\s+R\b/.exec(rest);
    if (ref) return ref[0];
    const token = /^[^\s/<>[\]()]+|^\/[^\s/<>[\]()]*/.exec(rest);
    return token ? token[0] : null;
  }
  return null;
}

function nestingDepth(dict: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (dict[i] === "(") {
      i = skipLiteralString(dict, i) - 1;
      continue;
    }
    if (dict.startsWith("<<", i)) {
      depth++;
      i++;
    } else if (dict.startsWith(">>", i)) {
      depth--;
      i++;
    }
  }
  return depth;
}

function parseRef(token: string | null): number | null {
  if (!token) return null;
  const m = /^(\d+)\s+\d+\s+R\b/.exec(token.trim());
  return m ? Number(m[1]) : null;
}

function parseRefList(token: string | null): number[] {
  if (!token) return [];
  const refs: number[] = [];
  const re = /(\d+)\s+\d+\s+R\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(token)) !== null) refs.push(Number(m[1]));
  return refs;
}

function parseNumber(token: string | null): number | null {
  if (token === null) return null;
  const n = Number(token.trim());
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Stream filters
// ---------------------------------------------------------------------------

function ascii85Decode(input: string): Buffer | null {
  const text = input.replace(/\s+/g, "").replace(/^<~/, "").replace(/~>[\s\S]*$/, "");
  const out: number[] = [];
  let group: number[] = [];
  for (const ch of text) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const v = ch.charCodeAt(0) - 33;
    if (v < 0 || v > 84) return null;
    group.push(v);
    if (group.length === 5) {
      let n = 0;
      for (const g of group) n = n * 85 + g;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const pad = 5 - group.length;
    const padded = [...group, ...Array(pad).fill(84)];
    let n = 0;
    for (const g of padded) n = n * 85 + g;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...bytes.slice(0, 4 - pad));
  }
  return Buffer.from(out);
}

function decodeStream(dict: string, raw: Buffer): Buffer | null {
  const filterToken = dictGet(dict, "Filter");
  const filters = filterToken ? [...filterToken.matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1]!) : [];
  let data: Buffer | null = raw;
  for (const filter of filters) {
    if (!data) return null;
    switch (filter) {
      case "FlateDecode":
      case "Fl":
        try {
          data = inflateSync(data);
        } catch {
          try {
            data = inflateSync(data, { finishFlush: 2 /* Z_SYNC_FLUSH */ });
          } catch {
            try {
              data = inflateRawSync(data.subarray(2));
            } catch {
              return null;
            }
          }
        }
        break;
      case "ASCIIHexDecode":
      case "AHx": {
        const hex: string = data.toString("latin1").replace(/[^0-9a-fA-F]/g, "");
        data = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
        break;
      }
      case "ASCII85Decode":
      case "A85":
        data = ascii85Decode(data.toString("latin1"));
        break;
      default:
        return null; // LZW, DCT, JBIG2, CCITT...: not text content
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Object table
// ---------------------------------------------------------------------------

function buildObjectTable(buf: Buffer): Map<number, PdfObject> {
  const text = buf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const objRe = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = objRe.exec(text)) !== null) {
    const objNum = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const streamIdx = indexOfStreamKeyword(text, bodyStart);
    const endObjIdx = text.indexOf("endobj", bodyStart);
    if (endObjIdx === -1) break;

    if (streamIdx !== -1 && streamIdx < endObjIdx) {
      const dict = text.slice(bodyStart, streamIdx);
      let dataStart = streamIdx + "stream".length;
      if (text[dataStart] === "\r" && text[dataStart + 1] === "\n") dataStart += 2;
      else if (text[dataStart] === "\n" || text[dataStart] === "\r") dataStart += 1;

      let dataEnd = -1;
      const lengthToken = dictGet(dict, "Length");
      const directLength = lengthToken && !/R\b/.test(lengthToken) ? parseNumber(lengthToken) : null;
      if (directLength !== null && directLength >= 0 && text.startsWith("endstream", skipWhitespace(text, dataStart + directLength))) {
        dataEnd = dataStart + directLength;
      }
      if (dataEnd === -1) {
        const endStream = text.indexOf("endstream", dataStart);
        if (endStream === -1) continue;
        dataEnd = endStream;
        if (text[dataEnd - 1] === "\n") dataEnd--;
        if (text[dataEnd - 1] === "\r") dataEnd--;
      }
      if (dataEnd - dataStart > MAX_OBJECT_BYTES) continue;
      objects.set(objNum, { dict, stream: buf.subarray(dataStart, dataEnd) });
      objRe.lastIndex = text.indexOf("endobj", dataEnd) + 6;
      if (objRe.lastIndex < 6) break;
    } else {
      objects.set(objNum, { dict: text.slice(bodyStart, endObjIdx), stream: null });
      objRe.lastIndex = endObjIdx + 6;
    }
  }

  // Expand object streams (PDF 1.5+).
  for (const [, obj] of [...objects]) {
    if (!obj.stream || !/\/Type\s*\/ObjStm/.test(obj.dict)) continue;
    const decoded = decodeStream(obj.dict, obj.stream);
    if (!decoded) continue;
    const n = parseNumber(dictGet(obj.dict, "N")) ?? 0;
    const first = parseNumber(dictGet(obj.dict, "First")) ?? 0;
    const content = decoded.toString("latin1");
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const offset = header[i * 2 + 1];
      if (num === undefined || offset === undefined || Number.isNaN(num) || Number.isNaN(offset)) continue;
      const nextOffset = header[(i + 1) * 2 + 1];
      const slice = content.slice(first + offset, nextOffset !== undefined && !Number.isNaN(nextOffset) ? first + nextOffset : undefined);
      if (!objects.has(num)) objects.set(num, { dict: slice, stream: null });
    }
  }

  return objects;
}

function indexOfStreamKeyword(text: string, from: number): number {
  const endObj = text.indexOf("endobj", from);
  let idx = text.indexOf("stream", from);
  while (idx !== -1 && (endObj === -1 || idx < endObj)) {
    const prev = text.slice(Math.max(0, idx - 3), idx);
    if (!prev.endsWith("end")) {
      const next = text[idx + 6];
      if (next === "\r" || next === "\n") return idx;
    }
    idx = text.indexOf("stream", idx + 6);
  }
  return -1;
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

type FontInfo = {
  /** bytes consumed per character code (1 for simple fonts, usually 2 for Type0) */
  codeBytes: number;
  toUnicode: Map<number, string> | null;
  widths: Map<number, number>;
  defaultWidth: number;
  undecodable: boolean;
  differences: Map<number, string> | null;
  encoding: "win" | "mac" | "std";
};

const CP1252_EXTRA: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹",
  0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™",
  0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

const GLYPH_NAMES: Record<string, string> = {
  space: " ", period: ".", comma: ",", hyphen: "-", minus: "-", endash: "–", emdash: "—", slash: "/", backslash: "\\", colon: ":",
  semicolon: ";", at: "@", ampersand: "&", percent: "%", dollar: "$", numbersign: "#", plus: "+", equal: "=", parenleft: "(",
  parenright: ")", bracketleft: "[", bracketright: "]", underscore: "_", quotesingle: "'", quotedbl: '"', asterisk: "*",
  exclam: "!", question: "?", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", bullet: "•", quoteright: "’", quoteleft: "‘",
};

function decodeHexString(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 2) bytes.push(parseInt(padded.slice(i, i + 2), 16));
  return bytes;
}

function utf16beToString(bytes: number[]): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  if (bytes.length === 1) out += String.fromCharCode(bytes[0]!);
  return out;
}

function parseToUnicode(cmap: string): { map: Map<number, string>; codeBytes: number } {
  const map = new Map<number, string>();
  let codeBytes = 0;

  const spaceRe = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  let m: RegExpExecArray | null;
  while ((m = spaceRe.exec(cmap)) !== null) {
    const first = /<([0-9a-fA-F]+)>/.exec(m[1]!);
    if (first) codeBytes = Math.max(codeBytes, Math.ceil(first[1]!.length / 2));
  }

  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = charRe.exec(cmap)) !== null) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g;
    let p: RegExpExecArray | null;
    while ((p = pairRe.exec(m[1]!)) !== null) {
      map.set(parseInt(p[1]!, 16), utf16beToString(decodeHexString(p[2]!)));
      codeBytes = Math.max(codeBytes, Math.ceil(p[1]!.length / 2));
    }
  }

  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(cmap)) !== null) {
    const body = m[1]!;
    const itemRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]*>)/g;
    let r: RegExpExecArray | null;
    while ((r = itemRe.exec(body)) !== null) {
      const lo = parseInt(r[1]!, 16);
      const hi = parseInt(r[2]!, 16);
      codeBytes = Math.max(codeBytes, Math.ceil(r[1]!.length / 2));
      if (hi < lo || hi - lo > 0xffff) continue;
      const target = r[3]!;
      if (target.startsWith("[")) {
        const dests = [...target.matchAll(/<([0-9a-fA-F]*)>/g)].map((d) => utf16beToString(decodeHexString(d[1]!)));
        for (let i = 0; i <= hi - lo && i < dests.length; i++) map.set(lo + i, dests[i]!);
      } else {
        const destBytes = decodeHexString(target.slice(1, -1));
        const base = utf16beToString(destBytes);
        const lastCode = base.length > 0 ? base.charCodeAt(base.length - 1) : 0;
        for (let i = 0; i <= hi - lo; i++) {
          map.set(lo + i, base.length > 0 ? base.slice(0, -1) + String.fromCharCode(lastCode + i) : "");
        }
      }
    }
  }

  return { map, codeBytes };
}

function parseWidths(font: string, objects: Map<number, PdfObject>): { widths: Map<number, number>; defaultWidth: number } {
  const widths = new Map<number, number>();
  let defaultWidth = 500;

  const first = parseNumber(dictGet(font, "FirstChar"));
  let widthsToken = dictGet(font, "Widths");
  const widthRef = parseRef(widthsToken);
  if (widthRef !== null) widthsToken = objects.get(widthRef)?.dict.trim() ?? null;
  if (first !== null && widthsToken && widthsToken.trim().startsWith("[")) {
    const nums = [...widthsToken.matchAll(/-?\d+(?:\.\d+)?/g)].map((n) => Number(n[0]));
    nums.forEach((w, i) => widths.set(first + i, w));
  }

  const descRef = parseRef(dictGet(font, "FontDescriptor"));
  if (descRef !== null) {
    const missing = parseNumber(dictGet(objects.get(descRef)?.dict ?? "", "MissingWidth"));
    if (missing !== null && missing > 0) defaultWidth = missing;
  }

  // Type0: /DW and /W live on the descendant font.
  const descendant = dictGet(font, "DescendantFonts");
  if (descendant) {
    const dRef = parseRefList(descendant)[0];
    const dFont = dRef !== undefined ? objects.get(dRef)?.dict : descendant;
    if (dFont) {
      const dw = parseNumber(dictGet(dFont, "DW"));
      if (dw !== null) defaultWidth = dw;
      let wToken = dictGet(dFont, "W");
      const wRef = parseRef(wToken);
      if (wRef !== null) wToken = objects.get(wRef)?.dict.trim() ?? null;
      if (wToken) {
        const body = wToken.trim().replace(/^\[/, "").replace(/\]$/, "");
        const re = /(\d+)\s*\[([^\]]*)\]|(\d+)\s+(\d+)\s+(-?\d+(?:\.\d+)?)/g;
        let w: RegExpExecArray | null;
        while ((w = re.exec(body)) !== null) {
          if (w[1] !== undefined) {
            const start = Number(w[1]);
            w[2]!.trim().split(/\s+/).filter(Boolean).forEach((v, i) => widths.set(start + i, Number(v)));
          } else {
            const lo = Number(w[3]);
            const hi = Number(w[4]);
            if (hi - lo < 70000) for (let c = lo; c <= hi; c++) widths.set(c, Number(w[5]));
          }
        }
      }
    }
  }

  return { widths, defaultWidth };
}

function loadFont(fontDict: string, objects: Map<number, PdfObject>): FontInfo {
  const subtype = dictGet(fontDict, "Subtype") ?? "";
  const encodingToken = dictGet(fontDict, "Encoding") ?? "";
  const isType0 = subtype === "/Type0";

  let toUnicode: Map<number, string> | null = null;
  let codeBytes = isType0 ? 2 : 1;

  const toUnicodeRef = parseRef(dictGet(fontDict, "ToUnicode"));
  if (toUnicodeRef !== null) {
    const obj = objects.get(toUnicodeRef);
    const decoded = obj?.stream ? decodeStream(obj.dict, obj.stream) : null;
    if (decoded) {
      const parsed = parseToUnicode(decoded.toString("latin1"));
      if (parsed.map.size > 0) {
        toUnicode = parsed.map;
        if (parsed.codeBytes > 0) codeBytes = parsed.codeBytes;
      }
    }
  }

  let differences: Map<number, string> | null = null;
  let encodingDict = encodingToken;
  const encRef = parseRef(encodingToken);
  if (encRef !== null) encodingDict = objects.get(encRef)?.dict ?? "";
  const diffToken = dictGet(encodingDict, "Differences");
  if (diffToken) {
    differences = new Map();
    let code = 0;
    for (const tok of diffToken.replace(/^\[|\]$/g, "").trim().split(/\s+/)) {
      if (/^\d+$/.test(tok)) code = Number(tok);
      else if (tok.startsWith("/")) differences.set(code++, tok.slice(1));
    }
  }

  const encoding: FontInfo["encoding"] = /MacRoman/.test(encodingToken) ? "mac" : /Standard/.test(encodingToken) ? "std" : "win";
  const { widths, defaultWidth } = parseWidths(fontDict, objects);

  // A Type0 font with no ToUnicode cannot be decoded reliably (raw CIDs).
  const undecodable = isType0 && toUnicode === null;

  return { codeBytes, toUnicode, widths, defaultWidth, undecodable, differences, encoding };
}

function glyphNameToChar(name: string): string {
  if (GLYPH_NAMES[name]) return GLYPH_NAMES[name]!;
  if (name.length === 1) return name;
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (uni) return String.fromCharCode(parseInt(uni[1]!, 16));
  return "";
}

function decodeText(bytes: number[], font: FontInfo): { text: string; codes: number[] } {
  const codes: number[] = [];
  const step = Math.max(1, font.codeBytes);
  for (let i = 0; i + step <= bytes.length; i += step) {
    let code = 0;
    for (let b = 0; b < step; b++) code = (code << 8) | bytes[i + b]!;
    codes.push(code);
  }

  let text = "";
  for (const code of codes) {
    const mapped = font.toUnicode?.get(code);
    if (mapped !== undefined) {
      text += mapped;
      continue;
    }
    const diff = font.differences?.get(code);
    if (diff !== undefined) {
      text += glyphNameToChar(diff);
      continue;
    }
    if (font.undecodable) continue;
    if (code === 0) continue;
    text += CP1252_EXTRA[code] ?? String.fromCharCode(code);
  }
  return { text, codes };
}

// ---------------------------------------------------------------------------
// Content stream interpreter
// ---------------------------------------------------------------------------

type Run = { x: number; y: number; endX: number; size: number; text: string };

type Token =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "str"; v: number[] }
  | { t: "arr"; v: Token[] }
  | { t: "op"; v: string };

function readLiteralString(text: string, start: number): { bytes: number[]; end: number } {
  const bytes: number[] = [];
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\") {
      const n = text[++i];
      if (n === undefined) break;
      if (n === "n") bytes.push(10);
      else if (n === "r") bytes.push(13);
      else if (n === "t") bytes.push(9);
      else if (n === "b") bytes.push(8);
      else if (n === "f") bytes.push(12);
      else if (n === "\r") {
        if (text[i + 1] === "\n") i++;
      } else if (n === "\n") {
        // line continuation
      } else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(text[i + 1] ?? "")) oct += text[++i];
        bytes.push(parseInt(oct, 8) & 255);
      } else bytes.push(n.charCodeAt(0) & 255);
      continue;
    }
    if (c === "(") {
      depth++;
      if (depth === 1) continue;
    } else if (c === ")") {
      depth--;
      if (depth === 0) return { bytes, end: i + 1 };
    }
    bytes.push(c.charCodeAt(0) & 255);
  }
  return { bytes, end: i };
}

function* tokenize(text: string): Generator<Token> {
  let i = 0;
  const n = text.length;
  const stack: Token[][] = [];
  const emit = function* (token: Token): Generator<Token> {
    if (stack.length > 0) stack[stack.length - 1]!.push(token);
    else yield token;
  };

  while (i < n) {
    const c = text[i]!;
    if (/\s/.test(c) || c === "\0") {
      i++;
      continue;
    }
    if (c === "%") {
      while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
      continue;
    }
    if (c === "(") {
      const { bytes, end } = readLiteralString(text, i);
      i = end;
      yield* emit({ t: "str", v: bytes });
      continue;
    }
    if (c === "<") {
      if (text[i + 1] === "<") {
        i = skipBalanced(text, i, "<<", ">>");
        continue;
      }
      const end = text.indexOf(">", i);
      const hex = text.slice(i + 1, end === -1 ? n : end);
      i = end === -1 ? n : end + 1;
      yield* emit({ t: "str", v: decodeHexString(hex) });
      continue;
    }
    if (c === "[") {
      stack.push([]);
      i++;
      continue;
    }
    if (c === "]") {
      const items = stack.pop() ?? [];
      i++;
      yield* emit({ t: "arr", v: items });
      continue;
    }
    if (c === "/") {
      let j = i + 1;
      while (j < n && !/[\s/<>[\]()%]/.test(text[j]!)) j++;
      const name = text.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      i = j;
      yield* emit({ t: "name", v: name });
      continue;
    }
    let j = i;
    while (j < n && !/[\s/<>[\]()%]/.test(text[j]!)) j++;
    if (j === i) {
      i++;
      continue;
    }
    const word = text.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      yield* emit({ t: "num", v: Number(word) });
    } else if (word === "BI") {
      // inline image: skip to EI
      const ei = /\sEI(?=\s|$)/.exec(text.slice(i));
      i = ei ? i + ei.index + ei[0].length : n;
    } else {
      yield* emit({ t: "op", v: word });
    }
  }
}

function interpretContent(content: string, fonts: Map<string, FontInfo>): Run[] {
  const runs: Run[] = [];
  let ctm: Matrix = IDENTITY;
  // q/Q save and restore the whole graphics state, which includes the text
  // state (font, size, spacing) -- generators rely on this heavily.
  type GState = { ctm: Matrix; font: FontInfo | null; fontSize: number; charSpace: number; wordSpace: number; hScale: number; leading: number; rise: number };
  const gStack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let font: FontInfo | null = null;
  let fontSize = 10;
  let charSpace = 0;
  let wordSpace = 0;
  let hScale = 1;
  let leading = 0;
  let rise = 0;
  const operands: Token[] = [];

  const num = (idx: number): number => {
    const t = operands[idx];
    return t && t.t === "num" ? t.v : 0;
  };

  const showString = (bytes: number[]): { text: string; advance: number } => {
    if (!font) return { text: "", advance: 0 };
    const { text, codes } = decodeText(bytes, font);
    let advance = 0;
    for (const code of codes) {
      const w = font.widths.get(code) ?? font.defaultWidth;
      advance += (w / 1000) * fontSize + charSpace + (code === 32 && font.codeBytes === 1 ? wordSpace : 0);
    }
    return { text, advance: advance * hScale };
  };

  const emitRun = (text: string, startAdvance: number, totalAdvance: number) => {
    if (text === "") return;
    const startM = multiply([1, 0, 0, 1, startAdvance, rise], multiply(tm, ctm));
    const endM = multiply([1, 0, 0, 1, startAdvance + totalAdvance, rise], multiply(tm, ctm));
    const scale = Math.hypot(tm[2], tm[3]) * Math.hypot(ctm[2], ctm[3]);
    runs.push({ x: startM[4], y: startM[5], endX: endM[4], size: Math.abs(fontSize * (scale || 1)), text });
  };

  for (const token of tokenize(content)) {
    if (token.t !== "op") {
      operands.push(token);
      if (operands.length > 64) operands.shift();
      continue;
    }

    switch (token.v) {
      case "q":
        gStack.push({ ctm, font, fontSize, charSpace, wordSpace, hScale, leading, rise });
        break;
      case "Q": {
        const saved = gStack.pop();
        if (saved) ({ ctm, font, fontSize, charSpace, wordSpace, hScale, leading, rise } = saved);
        break;
      }
      case "cm":
        ctm = multiply([num(0), num(1), num(2), num(3), num(4), num(5)], ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf": {
        const nameTok = operands[0];
        if (nameTok && nameTok.t === "name") font = fonts.get(nameTok.v) ?? null;
        fontSize = num(1);
        break;
      }
      case "Tc":
        charSpace = num(0);
        break;
      case "Tw":
        wordSpace = num(0);
        break;
      case "Tz":
        hScale = num(0) / 100 || 1;
        break;
      case "TL":
        leading = num(0);
        break;
      case "Ts":
        rise = num(0);
        break;
      case "Td":
        tlm = multiply([1, 0, 0, 1, num(0), num(1)], tlm);
        tm = tlm;
        break;
      case "TD":
        leading = -num(1);
        tlm = multiply([1, 0, 0, 1, num(0), num(1)], tlm);
        tm = tlm;
        break;
      case "Tm":
        tm = [num(0), num(1), num(2), num(3), num(4), num(5)];
        tlm = tm;
        break;
      case "T*":
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        break;
      case "Tj":
      case "'":
      case '"': {
        if (token.v !== "Tj") {
          tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
          tm = tlm;
        }
        if (token.v === '"') {
          wordSpace = num(0);
          charSpace = num(1);
        }
        const strTok = operands[operands.length - 1];
        if (strTok && strTok.t === "str") {
          const { text, advance } = showString(strTok.v);
          emitRun(text, 0, advance);
          tm = multiply([1, 0, 0, 1, advance, 0], tm);
        }
        break;
      }
      case "TJ": {
        const arr = operands[operands.length - 1];
        if (arr && arr.t === "arr") {
          let text = "";
          let advance = 0;
          for (const item of arr.v) {
            if (item.t === "str") {
              const shown = showString(item.v);
              text += shown.text;
              advance += shown.advance;
            } else if (item.t === "num") {
              const shift = (-item.v / 1000) * fontSize * hScale;
              // A big negative kerning value is how generators draw a visible gap.
              if (shift > fontSize * 0.25 && text !== "" && !text.endsWith(" ")) text += " ";
              advance += shift;
            }
          }
          emitRun(text, 0, advance);
          tm = multiply([1, 0, 0, 1, advance, 0], tm);
        }
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Page tree + layout
// ---------------------------------------------------------------------------

function collectPages(objects: Map<number, PdfObject>): number[] {
  const root = [...objects.entries()].find(([, o]) => /\/Type\s*\/Catalog/.test(o.dict));
  const pages: number[] = [];
  const seen = new Set<number>();

  const walk = (num: number) => {
    if (seen.has(num)) return;
    seen.add(num);
    const dict = objects.get(num)?.dict;
    if (!dict) return;
    if (/\/Type\s*\/Pages/.test(dict) || (dictGet(dict, "Kids") && !/\/Type\s*\/Page\b/.test(dict))) {
      for (const kid of parseRefList(dictGet(dict, "Kids"))) walk(kid);
    } else {
      pages.push(num);
    }
  };

  const pagesRef = root ? parseRef(dictGet(root[1].dict, "Pages")) : null;
  if (pagesRef !== null) walk(pagesRef);

  if (pages.length === 0) {
    for (const [num, o] of [...objects.entries()].sort((a, b) => a[0] - b[0])) {
      if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(num);
    }
  }
  return pages;
}

function inheritedValue(objects: Map<number, PdfObject>, pageNum: number, key: string): string | null {
  let current: number | null = pageNum;
  for (let depth = 0; current !== null && depth < 20; depth++) {
    const dict: string | undefined = objects.get(current)?.dict;
    if (!dict) return null;
    const value = dictGet(dict, key);
    if (value) return value;
    current = parseRef(dictGet(dict, "Parent"));
  }
  return null;
}

function resolveDict(token: string | null, objects: Map<number, PdfObject>): string | null {
  if (!token) return null;
  const ref = parseRef(token);
  if (ref !== null) return objects.get(ref)?.dict ?? null;
  return token;
}

function loadPageFonts(pageNum: number, objects: Map<number, PdfObject>, cache: Map<number, FontInfo>): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  const resources = resolveDict(inheritedValue(objects, pageNum, "Resources"), objects);
  if (!resources) return fonts;
  const fontDict = resolveDict(dictGet(resources, "Font"), objects);
  if (!fontDict) return fonts;

  const re = /\/([^\s/<>[\]()]+)\s*(\d+)\s+\d+\s+R/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fontDict)) !== null) {
    const num = Number(m[2]);
    let info = cache.get(num);
    if (!info) {
      const dict = objects.get(num)?.dict;
      if (!dict) continue;
      info = loadFont(dict, objects);
      cache.set(num, info);
    }
    fonts.set(m[1]!, info);
  }
  return fonts;
}

function pageContent(pageNum: number, objects: Map<number, PdfObject>): string {
  const dict = objects.get(pageNum)?.dict ?? "";
  const token = dictGet(dict, "Contents");
  const refs = token && token.trim().startsWith("[") ? parseRefList(token) : [parseRef(token)].filter((r): r is number => r !== null);
  const parts: string[] = [];
  for (const ref of refs) {
    const obj = objects.get(ref);
    if (!obj?.stream) continue;
    const decoded = decodeStream(obj.dict, obj.stream);
    if (decoded) parts.push(decoded.toString("latin1"));
  }
  return parts.join("\n");
}

function layoutLines(runs: Run[]): string[] {
  if (runs.length === 0) return [];

  // Remove "fake bold" duplicates (same text drawn twice at ~the same place).
  const unique: Run[] = [];
  for (const run of runs) {
    const dup = unique.some((u) => u.text === run.text && Math.abs(u.x - run.x) < 1.2 && Math.abs(u.y - run.y) < 1.2);
    if (!dup) unique.push(run);
  }

  const sizes = unique.map((r) => r.size).filter((s) => s > 0).sort((a, b) => a - b);
  const medianSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)]! : 10;
  const tolerance = Math.max(1.5, medianSize * 0.45);

  const sorted = [...unique].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Run[][] = [];
  for (const run of sorted) {
    const row = rows.find((r) => Math.abs(r[0]!.y - run.y) <= tolerance);
    if (row) row.push(run);
    else rows.push([run]);
  }
  rows.sort((a, b) => b[0]!.y - a[0]!.y);

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEnd: number | null = null;
    for (const run of row) {
      const text = run.text.replace(/\s+$/g, (ws) => (ws.length > 0 ? " " : ""));
      const gap = prevEnd === null ? 0 : run.x - prevEnd;
      if (prevEnd === null) {
        line = " ".repeat(Math.max(0, Math.round(run.x / AVG_CHAR_PTS)));
      } else if (gap > run.size * 0.7) {
        const targetCol = Math.round(run.x / AVG_CHAR_PTS);
        line = line.trimEnd();
        line += " ".repeat(Math.max(2, targetCol - line.length));
      } else if (gap > run.size * 0.12 && !line.endsWith(" ") && !text.startsWith(" ")) {
        line += " ";
      }
      line += text;
      prevEnd = Math.max(prevEnd ?? run.endX, run.endX);
    }
    const trimmed = line.replace(/\s+$/g, "");
    if (trimmed.trim() !== "") lines.push(trimmed);
  }

  // Remove common left indent so output is stable regardless of page margin.
  const indent = Math.min(...lines.map((l) => l.length - l.trimStart().length));
  return indent > 0 ? lines.map((l) => l.slice(indent)) : lines;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractPdfText(buffer: Buffer): PdfTextResult {
  if (buffer.length < 8 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, reason: "not-pdf", message: "This is not a PDF file." };
  }

  try {
    if (/\/Encrypt\b/.test(buffer.toString("latin1", Math.max(0, buffer.length - 4096)))) {
      return { ok: false, reason: "encrypted", message: "This PDF is password-protected. Remove the password and upload it again." };
    }

    const objects = buildObjectTable(buffer);
    const pageNums = collectPages(objects);
    if (pageNums.length === 0) {
      return { ok: false, reason: "unreadable", message: "No pages could be found in this PDF." };
    }

    const fontCache = new Map<number, FontInfo>();
    const pages: string[][] = [];
    let charCount = 0;

    for (const pageNum of pageNums) {
      const fonts = loadPageFonts(pageNum, objects, fontCache);
      const content = pageContent(pageNum, objects);
      const lines = layoutLines(interpretContent(content, fonts));
      for (const line of lines) charCount += line.replace(/\s/g, "").length;
      pages.push(lines);
    }

    return { ok: true, pages, text: pages.map((p) => p.join("\n")).join("\n\n"), charCount };
  } catch (error) {
    return { ok: false, reason: "unreadable", message: error instanceof Error ? error.message : "The PDF could not be read." };
  }
}
