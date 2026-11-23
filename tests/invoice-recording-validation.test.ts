import { describe, expect, it } from "vitest";
import {
  recordNativeInvoiceLineInputSchema,
  recordNativeInvoiceSchema,
  validateNativeInvoiceLineQuantity,
} from "@/lib/invoice-recording/validation";
// isNativelyRecordedInvoice lives in lib/invoice-recording/queries.ts,
// which (like every lib module that touches the real Prisma client)
// imports lib/prisma.ts and so constructs PrismaClient at module load --
// safe in production but fatal here, since this sandbox's generated
// client is an unusable stub (see every *-db.integration.test.ts file's
// own comment). Its tests therefore live in
// tests/invoice-recording-db.integration.test.ts behind a dynamic
// import, same as this project's established convention, not here.

/**
 * Real-world fix (native invoice recording). This feature (lib/invoice-
 * recording/*, built this engagement to close the gap where an order
 * invoiced and delivered without a SAP CSV import could never reach
 * Delivered Orders or have a delivery outcome recorded) shipped with NO
 * test coverage at all. This file covers the pure, DB-free logic --
 * same split as every other module in this codebase (validation.ts has
 * no @prisma/client import, so none of this needs the stubbed Prisma
 * client this sandbox cannot construct). The DB-backed half
 * (getInvoiceRecordingEligibility, recordNativeInvoice's transactional
 * insert and race-safe re-validation) is covered separately in
 * tests/invoice-recording-db.integration.test.ts.
 */
describe("validateNativeInvoiceLineQuantity", () => {
  it("accepts a quantity strictly less than what remains", () => {
    expect(validateNativeInvoiceLineQuantity("100.0000", "40.0000")).toEqual({ ok: true });
  });

  it("accepts a quantity exactly equal to what remains (fully invoicing the last of it)", () => {
    expect(validateNativeInvoiceLineQuantity("100.0000", "100.0000")).toEqual({ ok: true });
  });

  it("rejects a quantity exceeding what remains -- the 'never invoice more than went out the door' guarantee", () => {
    const result = validateNativeInvoiceLineQuantity("100.0000", "100.0001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/cannot exceed what is still outstanding/i);
  });

  it("rejects a zero quantity", () => {
    const result = validateNativeInvoiceLineQuantity("100.0000", "0.0000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/greater than zero/i);
  });

  it("rejects a negative quantity -- caught as an invalid decimal string, since parseScaledDecimal's pattern only accepts non-negative numbers", () => {
    const result = validateNativeInvoiceLineQuantity("100.0000", "-5.0000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/invalid quantity/i);
  });

  it("rejects when nothing remains to invoice (remaining is zero or negative)", () => {
    expect(validateNativeInvoiceLineQuantity("0.0000", "1.0000").ok).toBe(false);
    expect(validateNativeInvoiceLineQuantity("-10.0000", "1.0000").ok).toBe(false);
  });

  it("rejects a malformed remaining or quantity string rather than silently coercing it", () => {
    expect(validateNativeInvoiceLineQuantity("not-a-number", "10.0000").ok).toBe(false);
    expect(validateNativeInvoiceLineQuantity("100.0000", "not-a-number").ok).toBe(false);
  });
});

describe("recordNativeInvoiceLineInputSchema / recordNativeInvoiceSchema", () => {
  it("accepts a well-formed single-line input", () => {
    const result = recordNativeInvoiceSchema.safeParse({
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId: "line-1", quantityInvoiced: "10.0000", unitPrice: "5.0000" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts multiple lines", () => {
    const result = recordNativeInvoiceSchema.safeParse({
      invoiceDate: "2026-11-23",
      lines: [
        { orderLineId: "line-1", quantityInvoiced: "10.0000", unitPrice: "5.0000" },
        { orderLineId: "line-2", quantityInvoiced: "3.0000", unitPrice: "12.5000" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty lines array -- at least one line is required", () => {
    const result = recordNativeInvoiceSchema.safeParse({ invoiceDate: "2026-11-23", lines: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an invoiceDate that is not YYYY-MM-DD", () => {
    const result = recordNativeInvoiceSchema.safeParse({
      invoiceDate: "23/11/2026",
      lines: [{ orderLineId: "line-1", quantityInvoiced: "10.0000", unitPrice: "5.0000" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a line missing orderLineId", () => {
    const result = recordNativeInvoiceLineInputSchema.safeParse({ quantityInvoiced: "10.0000", unitPrice: "5.0000" });
    expect(result.success).toBe(false);
  });

  it("rejects a line with a malformed quantityInvoiced or unitPrice", () => {
    expect(recordNativeInvoiceLineInputSchema.safeParse({ orderLineId: "line-1", quantityInvoiced: "abc", unitPrice: "5.0000" }).success).toBe(false);
    expect(recordNativeInvoiceLineInputSchema.safeParse({ orderLineId: "line-1", quantityInvoiced: "10.0000", unitPrice: "abc" }).success).toBe(false);
  });
});
