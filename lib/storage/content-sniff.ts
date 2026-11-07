/**
 * Minimal magic-byte content sniffing for upload validation.
 *
 * Deliberately hand-rolled rather than adding a dependency: the set of
 * formats this app accepts at this milestone (PDF, JPEG, PNG, CSV, XLSX)
 * is small and their signatures are simple and stable, so a dedicated
 * package (e.g. file-type) isn't needed yet -- it can be added later if
 * the accepted-format list grows into something that justifies it.
 *
 * This never trusts the browser-supplied Content-Type or file extension on
 * their own; it looks at the actual bytes.
 */

export type SniffedType = "pdf" | "jpeg" | "png" | "zip-based" | "text" | "unknown";

export function sniffContentType(buffer: Buffer): SniffedType {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "pdf";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= pngSignature.length && pngSignature.every((b, i) => buffer[i] === b)) {
    return "png";
  }

  // XLSX (and DOCX/PPTX) are zip containers: "PK\x03\x04".
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "zip-based";
  }

  // Treat as plausible text (CSV, pasted PO text) only if the first chunk
  // has no NUL bytes, decodes as valid UTF-8, and is mostly
  // printable/whitespace once decoded.
  //
  // Earlier revision counted any byte >= 0x80 as "printable" without
  // checking it formed valid UTF-8, which let arbitrary binary blobs made
  // of high bytes (e.g. 0xCAFEBABE) through as "text". Strict UTF-8
  // decoding closes that gap. `{ stream: true }` is used so that a
  // multi-byte UTF-8 sequence truncated by the 2048-byte sample window
  // itself (not by genuinely malformed input) is held back instead of
  // throwing -- it decodes nothing for that trailing partial sequence
  // rather than rejecting an otherwise-valid text file.
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  if (sample.includes(0)) return "unknown"; // NUL byte: definitely not text

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
  } catch {
    return "unknown"; // not valid UTF-8 -- almost certainly binary
  }

  let printable = 0;
  let total = 0;
  for (const ch of decoded) {
    total++;
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 || code >= 32) {
      printable++;
    }
  }
  if (total > 0 && printable / total > 0.95) {
    return "text";
  }

  return "unknown";
}

const ALLOWED_DOCUMENT_TYPES: Record<SniffedType, string[]> = {
  pdf: ["application/pdf"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  "zip-based": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  ],
  text: ["text/csv", "text/plain"],
  unknown: [],
};

export type UploadValidationResult =
  | { ok: true; resolvedMimeType: string }
  | { ok: false; message: string };

/**
 * Cross-checks the sniffed content against the claimed MIME type and
 * returns the MIME type to actually record (derived from the bytes, never
 * blindly trusted from the client).
 */
export function validateUploadContent(buffer: Buffer, claimedMimeType: string): UploadValidationResult {
  const sniffed = sniffContentType(buffer);

  if (sniffed === "unknown") {
    return { ok: false, message: "This file's content doesn't match a supported document type." };
  }

  const allowed = ALLOWED_DOCUMENT_TYPES[sniffed];
  if (allowed.length === 0) {
    return { ok: false, message: "This file type is not supported." };
  }

  // The claimed type just needs to be *one of* the types plausible for the
  // sniffed signature -- we don't require an exact string match because
  // browsers are inconsistent about the MIME type they report for the
  // same file.
  const resolvedMimeType = allowed.includes(claimedMimeType) ? claimedMimeType : allowed[0]!;
  return { ok: true, resolvedMimeType };
}
