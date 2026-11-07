import { describe, it, expect } from "vitest";
import { sniffContentType, validateUploadContent } from "@/lib/storage/content-sniff";

describe("sniffContentType", () => {
  it("detects a PDF by its %PDF- signature", () => {
    const buffer = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("rest of file")]);
    expect(sniffContentType(buffer)).toBe("pdf");
  });

  it("detects a JPEG by its FF D8 FF signature", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffContentType(buffer)).toBe("jpeg");
  });

  it("detects a PNG by its 8-byte signature", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(sniffContentType(buffer)).toBe("png");
  });

  it("detects a zip-based file (xlsx) by its PK\\x03\\x04 signature", () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(sniffContentType(buffer)).toBe("zip-based");
  });

  it("treats plain printable text as text", () => {
    const buffer = Buffer.from("sapItemCode,itemName\n100089,APPLES G/D ECON 1.5KG\n", "utf-8");
    expect(sniffContentType(buffer)).toBe("text");
  });

  it("rejects binary content containing a NUL byte as unknown, even if it starts with printable bytes", () => {
    const buffer = Buffer.from([0x41, 0x42, 0x43, 0x00, 0x44, 0x45]);
    expect(sniffContentType(buffer)).toBe("unknown");
  });

  it("rejects an arbitrary binary blob with no recognized signature", () => {
    const buffer = Buffer.from([0x13, 0x37, 0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x80, 0x81]);
    expect(sniffContentType(buffer)).toBe("unknown");
  });

  it("does not misdetect a short buffer as a signature it only partially matches", () => {
    // Looks like the start of a PNG signature but is too short, and isn't
    // valid UTF-8/ASCII text either in a way that would pass the text
    // heuristic cleanly -- exercises the length guards on each check.
    const buffer = Buffer.from([0x89, 0x50]);
    expect(sniffContentType(buffer)).not.toBe("png");
  });
});

describe("validateUploadContent", () => {
  it("accepts a PDF with the matching claimed MIME type", () => {
    const buffer = Buffer.from("%PDF-1.4\n...");
    const result = validateUploadContent(buffer, "application/pdf");
    expect(result).toEqual({ ok: true, resolvedMimeType: "application/pdf" });
  });

  it("resolves the MIME type from the bytes, ignoring a mismatched claimed type", () => {
    const buffer = Buffer.from("%PDF-1.4\n...");
    // Browser claims it's something else entirely -- the sniffed, actual
    // content type wins.
    const result = validateUploadContent(buffer, "image/png");
    expect(result).toEqual({ ok: true, resolvedMimeType: "application/pdf" });
  });

  it("rejects content that doesn't match any supported document type", () => {
    const buffer = Buffer.from([0xca, 0xfe, 0xba, 0xbe]); // Java class file magic, not supported here
    const result = validateUploadContent(buffer, "application/octet-stream");
    expect(result.ok).toBe(false);
  });

  it("accepts a CSV upload claimed as text/csv", () => {
    const buffer = Buffer.from("a,b,c\n1,2,3\n");
    const result = validateUploadContent(buffer, "text/csv");
    expect(result).toEqual({ ok: true, resolvedMimeType: "text/csv" });
  });
});
