/**
 * Dependency-free PDF writer for the Warehouse Assembly Form download.
 *
 * Mirrors the on-screen printable form (same company header, order block, product table with blank
 * "Qty Found" / "Qty Unavailable" cells, remarks box and assembler sign-off) as a real A4 PDF using only
 * the PDF-standard Helvetica fonts (no embedding, no packages, no network). Pure: no I/O, no Date, so the
 * output is deterministic for a given input and unit-testable.
 *
 * Text is written in WinAnsi (Latin-1 range); a character outside it is replaced with "?" rather than
 * producing a corrupt file.
 */

export type AssemblyPdfLine = {
  lineNumber: number;
  sapItemCode: string | null;
  description: string;
  requestedQuantity: string;
  requestedUnitCode: string;
};

export type AssemblyPdfInput = {
  companyName: string;
  companyAddress: string;
  companyTagline: string;
  customerName: string;
  customerPoReference: string | null;
  orderReference: string;
  orderDate: string;
  lines: AssemblyPdfLine[];
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Helvetica advance widths (1/1000 em) for ASCII 32..126.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function sanitize(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13) out += " ";
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else if (code === 0x2013 || code === 0x2014) out += "-"; // en/em dash
    else if (code === 0x2018 || code === 0x2019) out += "'";
    else if (code === 0x201c || code === 0x201d) out += '"';
    else out += "?";
  }
  return out;
}

export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of sanitize(text)) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 126 ? HELV[code - 32] : 556;
  }
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

function escapePdf(text: string): string {
  return sanitize(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Greedy word wrap to `maxWidth`; an over-long single word is hard-split so it can never overflow its cell. */
export function wrapText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const push = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (const word of words) {
    let w = word;
    while (textWidth(w, size, bold) > maxWidth) {
      let cut = w.length - 1;
      while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > maxWidth) cut -= 1;
      push();
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const candidate = current ? `${current} ${w}` : w;
    if (textWidth(candidate, size, bold) <= maxWidth) current = candidate;
    else {
      push();
      current = w;
    }
  }
  push();
  return lines.length > 0 ? lines : [""];
}

class Page {
  readonly ops: string[] = [];
  /** y is measured from the TOP of the page, like a screen. */
  text(x: number, y: number, value: string, size: number, bold = false, gray = 0) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g ${x.toFixed(2)} ${(PAGE_H - y).toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6) {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${(PAGE_H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - y2).toFixed(2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, fillGray?: number) {
    const rectOp = `${x.toFixed(2)} ${(PAGE_H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`;
    if (fillGray !== undefined) this.ops.push(`${fillGray} g ${rectOp} f`);
    this.ops.push(`0.6 G 0.5 w ${rectOp} S`);
  }
}

const COLS = [
  { key: "no", label: "#", w: 24, align: "left" },
  { key: "code", label: "SAP Item Code", w: 82, align: "left" },
  { key: "desc", label: "Official Product Description", w: 166, align: "left" },
  { key: "qty", label: "Requested Qty", w: 58, align: "right" },
  { key: "unit", label: "Unit", w: 33, align: "center" },
  { key: "found", label: "Qty Found", w: 76, align: "center" },
  { key: "unavail", label: "Qty Unavail.", w: 76, align: "center" },
] as const;

export function buildAssemblyFormPdf(input: AssemblyPdfInput): Buffer {
  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);
  let y = MARGIN;

  const drawCompanyHeader = () => {
    page.text(MARGIN, y + 12, input.companyName, 15, true, 0.1);
    page.text(MARGIN, y + 26, input.companyAddress, 8.5, false, 0.35);
    page.text(MARGIN, y + 38, input.companyTagline, 7.5, false, 0.5);
    const title = "Warehouse Assembly Form";
    page.text(PAGE_W - MARGIN - textWidth(title.toUpperCase(), 10.5, true), y + 12, title.toUpperCase(), 10.5, true, 0.1);
    const note = "Not an invoice or SAP handover document";
    page.text(PAGE_W - MARGIN - textWidth(note, 7.5), y + 25, note, 7.5, false, 0.5);
    y += 46;
    page.line(MARGIN, y, PAGE_W - MARGIN, y, 1.6, 0.2);
    y += 16;
  };

  const drawOrderBlock = () => {
    const half = CONTENT_W / 2 - 10;
    const rows: [string, string, string, string][] = [
      ["Customer", input.customerName, "SalesFlow Order Reference", input.orderReference],
      ["Customer PO Number", input.customerPoReference ?? "-", "Order Date", input.orderDate],
    ];
    for (const [l1, v1, l2, v2] of rows) {
      const left = wrapText(v1, 9, half - 104);
      const right = wrapText(v2, 9, half - 120);
      const height = Math.max(left.length, right.length) * 11 + 5;
      page.text(MARGIN, y + 9, l1, 8.5, true, 0.35);
      left.forEach((t, i) => page.text(MARGIN + 104, y + 9 + i * 11, t, 9, false, 0.1));
      const x2 = MARGIN + CONTENT_W / 2 + 10;
      page.text(x2, y + 9, l2, 8.5, true, 0.35);
      right.forEach((t, i) => page.text(x2 + 120, y + 9 + i * 11, t, 9, false, 0.1));
      y += height;
      page.line(MARGIN, y, MARGIN + half, y, 0.4, 0.7);
      page.line(MARGIN + CONTENT_W / 2 + 10, y, PAGE_W - MARGIN, y, 0.4, 0.7);
      y += 7;
    }
    y += 8;
  };

  const drawTableHeader = () => {
    const h = 22;
    let x = MARGIN;
    for (const col of COLS) {
      page.rect(x, y, col.w, h, 0.95);
      const lines = wrapText(col.label, 7.5, col.w - 6, true);
      lines.forEach((t, i) => {
        const tw = textWidth(t, 7.5, true);
        const tx = col.align === "right" ? x + col.w - 3 - tw : col.align === "center" ? x + (col.w - tw) / 2 : x + 3;
        page.text(tx, y + 9 + i * 9 - (lines.length - 1) * 4, t, 7.5, true, 0.3);
      });
      x += col.w;
    }
    y += h;
  };

  const newPage = () => {
    page = new Page();
    pages.push(page);
    y = MARGIN;
    drawTableHeader();
  };

  drawCompanyHeader();
  drawOrderBlock();
  drawTableHeader();

  for (const line of input.lines) {
    const descLines = wrapText(line.description, 8.5, COLS[2].w - 6);
    const codeLines = wrapText(line.sapItemCode ?? "-", 8.5, COLS[1].w - 6);
    const rowH = Math.max(26, Math.max(descLines.length, codeLines.length) * 10.5 + 10);
    if (y + rowH > PAGE_H - MARGIN - 30) newPage();
    let x = MARGIN;
    for (const col of COLS) {
      page.rect(x, y, col.w, rowH);
      const draw = (lines: string[], bold = false) =>
        lines.forEach((t, i) => {
          const tw = textWidth(t, 8.5, bold);
          const tx = col.align === "right" ? x + col.w - 3 - tw : col.align === "center" ? x + (col.w - tw) / 2 : x + 3;
          page.text(tx, y + 12 + i * 10.5, t, 8.5, bold, 0.15);
        });
      if (col.key === "no") draw([String(line.lineNumber)]);
      else if (col.key === "code") draw(codeLines);
      else if (col.key === "desc") draw(descLines);
      else if (col.key === "qty") draw([line.requestedQuantity], true);
      else if (col.key === "unit") draw([line.requestedUnitCode]);
      // "found" and "unavail" stay blank for the assembler to write in.
      x += col.w;
    }
    y += rowH;
  }

  // Remarks + sign-off need ~150pt; start a fresh page rather than splitting the sign-off block.
  if (y + 170 > PAGE_H - MARGIN) {
    page = new Page();
    pages.push(page);
    y = MARGIN;
  }
  y += 18;
  page.text(MARGIN, y, "REMARKS", 8.5, true, 0.35);
  y += 6;
  page.rect(MARGIN, y, CONTENT_W, 58);
  y += 58 + 30;
  const third = CONTENT_W / 3;
  ["ASSEMBLER NAME", "DATE", "SIGNATURE"].forEach((label, i) => {
    const x = MARGIN + i * third + (i === 0 ? 0 : 12);
    page.text(x, y, label, 8.5, true, 0.35);
    page.line(x, y + 24, x + third - 24, y + 24, 0.7, 0.5);
  });
  y += 56;
  const footer = "Return this completed form to the salesperson. Found and unavailable quantities will be recorded in SalesFlow's Fulfilment section exactly as written here.";
  wrapText(footer, 7.5, CONTENT_W).forEach((t, i) => page.text(MARGIN, y + i * 9, t, 7.5, false, 0.5));

  // Page numbers.
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.text(PAGE_W - MARGIN - textWidth(label, 7.5), PAGE_H - 22, label, 7.5, false, 0.5);
  });

  return serialize(pages);
}

function serialize(pages: Page[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };
  const catalog = add("");
  const pagesRoot = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const p of pages) {
    const stream = p.ops.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
