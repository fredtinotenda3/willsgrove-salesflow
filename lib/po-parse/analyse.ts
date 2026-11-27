/**
 * One entry point for every way an order can arrive:
 *   pasted text (email / WhatsApp)  -> free-text or table parser, no AI needed
 *   PDF with a text layer           -> PDF reader + table parser, no AI needed
 *   CSV / XLSX                      -> existing deterministic parsers
 *   photo / scan / handwritten      -> vision model (needs ANTHROPIC_API_KEY)
 *
 * The result is provider-independent (ParseOutput) so the matching and the
 * form do not care how the lines were read.
 */
import "server-only";
import { extractPdfText } from "@/lib/po-parse/pdf-text";
import { parseTable } from "@/lib/po-parse/table-parser";
import { parseFreeText } from "@/lib/po-parse/text-parser";
import { extractHeader } from "@/lib/po-parse/header";
import { emptyHeader, type ParseOutput, type ParsedLine } from "@/lib/po-parse/types";
import { canonicalUnit, parsePackSize } from "@/lib/po-parse/units";
import { sniffContentType } from "@/lib/storage/content-sniff";
import { createAnthropicProvider } from "@/lib/extraction/providers/anthropic";
import { parseCustomerPoCsv } from "@/lib/extraction/deterministic/csv";
import { parseCustomerPoExcel } from "@/lib/extraction/deterministic/excel";
import type { ExtractionResult } from "@/lib/extraction/schema";

export type AnalyseInput = { text?: string; file?: { buffer: Buffer; name: string; claimedMime: string } };

export type AnalyseFailure = {
  ok: false;
  code: "EMPTY" | "NEEDS_VISION_KEY" | "ENCRYPTED_PDF" | "UNREADABLE" | "NO_LINES" | "VISION_FAILED" | "UNSUPPORTED";
  message: string;
};
export type AnalyseSuccess = { ok: true; output: ParseOutput; source: "text" | "pdf-text" | "spreadsheet" | "vision" };
export type AnalyseResult = AnalyseSuccess | AnalyseFailure;

function fromExtraction(result: ExtractionResult): ParseOutput {
  const names: string[] = [];
  const h = result.header;
  const combined = [h.customerNameRaw, h.storeOrBranchRaw].filter(Boolean).join(" ").trim();
  for (const n of [combined, h.customerNameRaw, h.storeOrBranchRaw]) if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  const notes: string[] = [];
  if (result.classification === "UNRELATED") notes.push("This document does not look like a customer order.");
  if (result.classification === "PRICE_LIST") notes.push("This looks like a price list, not an order.");
  if (result.classification === "DELIVERY_NOTE") notes.push("This looks like a delivery note, not an order.");

  const lines: ParsedLine[] = result.lines.map((l, i) => {
    const pack = parsePackSize(l.originalDescription);
    return {
      lineNumber: i + 1,
      rawText: l.originalDescription,
      description: l.originalDescription,
      quantity: l.extractedQuantity,
      unit: canonicalUnit(l.extractedUnit) ?? (l.extractedUnit ? l.extractedUnit.toUpperCase().slice(0, 20) : null),
      packSize: pack ? pack.label : null,
      measureOnly: false,
      unitPrice: l.customerProvidedUnitPrice,
      customerItemCode: null,
      confidence: l.confidence ?? 0.7,
      warnings: l.warnings,
    };
  });
  return {
    mode: "table",
    header: {
      ...emptyHeader(),
      customerNameCandidates: names,
      poNumber: h.customerPoNumber,
      orderDate: h.poDate,
      requestedDeliveryDate: h.requestedDeliveryDate,
      deliveryAddress: h.deliveryAddressRaw,
      currency: h.currencyRaw,
    },
    lines,
    notes,
  };
}

function parseLayoutText(lines: string[]): ParseOutput | null {
  const header = extractHeader(lines);
  const table = parseTable(lines);
  if (table) return { mode: "table", header, lines: table.lines, notes: [] };

  // No table header: free text. Skip the header block lines that were already understood.
  const free = parseFreeText(lines.join("\n"));
  if (free.lines.length === 0) return null;
  return { mode: "text", header, lines: free.lines, notes: [] };
}

async function viaVision(buffer: Buffer, kind: "pdf" | "jpeg" | "png", name: string): Promise<AnalyseResult> {
  const provider = createAnthropicProvider();
  if (!provider || process.env.EXTRACTION_PROVIDER === "mock") {
    return {
      ok: false,
      code: "NEEDS_VISION_KEY",
      message:
        kind === "pdf"
          ? "This PDF is a scan (it has no readable text) so it has to be read as an image. Set ANTHROPIC_API_KEY on the server to enable that, or enter the lines manually."
          : "Reading photos and handwritten forms needs an image-reading model. Set ANTHROPIC_API_KEY on the server to enable it, or paste the order text / upload the PDF instead.",
    };
  }
  const base64Data = buffer.toString("base64");
  const outcome = await provider.extract(
    kind === "pdf"
      ? { kind: "document", mimeType: "application/pdf", base64Data, fileName: name }
      : { kind: "image", mimeType: kind === "png" ? "image/png" : "image/jpeg", base64Data, fileName: name }
  );
  if (!outcome.ok) return { ok: false, code: "VISION_FAILED", message: `The document could not be read automatically (${outcome.errorMessage}). Enter the lines manually.` };
  const output = fromExtraction(outcome.result);
  if (output.lines.length === 0) return { ok: false, code: "NO_LINES", message: output.notes[0] ?? "No order lines were found in this document." };
  return { ok: true, output, source: "vision" };
}

export async function analysePo(input: AnalyseInput): Promise<AnalyseResult> {
  const text = input.text?.trim() ?? "";
  const file = input.file;

  if (file) {
    const kind = sniffContentType(file.buffer);
    const lowerName = file.name.toLowerCase();

    if (kind === "pdf") {
      const pdf = extractPdfText(file.buffer);
      if (!pdf.ok) {
        if (pdf.reason === "encrypted") return { ok: false, code: "ENCRYPTED_PDF", message: "This PDF is password-protected. Remove the protection (or print it to a new PDF) and upload it again." };
        if (pdf.reason === "unreadable") return viaVision(file.buffer, "pdf", file.name);
        return { ok: false, code: "UNREADABLE", message: pdf.message };
      }
      if (pdf.charCount >= 40) {
        const parsed = parseLayoutText(pdf.pages.flat());
        if (parsed) return { ok: true, output: parsed, source: "pdf-text" };
      }
      return viaVision(file.buffer, "pdf", file.name);
    }

    if (kind === "jpeg" || kind === "png") return viaVision(file.buffer, kind, file.name);

    if (kind === "zip-based" && /\.xlsx$/.test(lowerName)) {
      const parsed = await parseCustomerPoExcel(file.buffer);
      if (!parsed.ok) return { ok: false, code: "UNREADABLE", message: parsed.message };
      const output = fromExtraction(parsed.result);
      return output.lines.length > 0 ? { ok: true, output, source: "spreadsheet" } : { ok: false, code: "NO_LINES", message: "No order lines were found in this spreadsheet." };
    }

    if (kind === "text") {
      const content = file.buffer.toString("utf-8");
      if (/\.csv$/.test(lowerName) || /\.tsv$/.test(lowerName)) {
        const parsed = parseCustomerPoCsv(content);
        if (parsed.ok) {
          const output = fromExtraction(parsed.result);
          if (output.lines.length > 0) return { ok: true, output, source: "spreadsheet" };
        }
      }
      const parsed = parseLayoutText(content.split(/\r?\n/));
      return parsed ? { ok: true, output: parsed, source: "text" } : { ok: false, code: "NO_LINES", message: "No order lines were recognised in this file." };
    }

    return { ok: false, code: "UNSUPPORTED", message: "Unsupported file type. Upload a PDF, image (JPG/PNG), Excel (.xlsx), CSV or text file." };
  }

  if (text === "") return { ok: false, code: "EMPTY", message: "Paste the order text or attach a file first." };
  const parsed = parseLayoutText(text.split(/\r?\n/));
  if (!parsed) return { ok: false, code: "NO_LINES", message: "No order lines could be recognised in this text. Expected something like \"tomatoes 5kg\" or \"onions x 3\", one item per line." };
  return { ok: true, output: parsed, source: "text" };
}
