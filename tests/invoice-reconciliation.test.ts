import { describe, it, expect } from "vitest";
import {
  parseInvoiceCsvForPreview,
  suggestColumnMapping,
  validateColumnMapping,
  applyColumnMapping,
  groupIntoInvoices,
  type InvoiceColumnMapping,
} from "@/lib/invoice-reconciliation/csv";
import { computeOrderLineReconciliation, deriveInvoiceReconciliationStatus } from "@/lib/invoice-reconciliation/reconcile";
import { matchInvoiceLineToOrder, type MatchCandidateOrder } from "@/lib/invoice-reconciliation/matching";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Pure, no-database unit tests
 * for lib/invoice-reconciliation/csv.ts, reconcile.ts and matching.ts --
 * none of these import @prisma/client, so (unlike the DB-gated
 * invoice-reconciliation-db.integration.test.ts) they run in every
 * environment, including this sandbox. Covers spec test scenarios 2
 * (invalid import), 7 (product matching by SAP item code), 8-11 (full/
 * partial/uninvoiced/over-invoicing reconciliation), 15 (ambiguous match
 * -> manual queue), 17 (cancelled/reversed derivation), 19 (decimal
 * quantities) at the pure-function level; the DB-gated file exercises
 * the same scenarios end-to-end against real persisted rows.
 */

const FULL_MAPPING: InvoiceColumnMapping = {
  docEntry: "DocEntry",
  docNum: "DocNum",
  customerCode: "CardCode",
  customerName: "CardName",
  invoiceDate: "DocDate",
  currency: "DocCur",
  documentStatus: "DocStatus",
  orderReference: "NumAtCard",
  subtotal: "DocTotalBeforeDisc",
  taxTotal: "VatSum",
  total: "DocTotal",
  lineNumber: "LineNum",
  itemCode: "ItemCode",
  itemDescription: "Dscription",
  quantity: "Quantity",
  unitOfMeasure: "UomCode",
  unitPrice: "Price",
  discount: "DiscPrcnt",
  taxCode: "VatGroup",
  lineTotal: "LineTotal",
  docLineNum: "LineNum",
};

const CSV_HEADER =
  "DocEntry,DocNum,CardCode,CardName,DocDate,DocCur,DocStatus,NumAtCard,DocTotalBeforeDisc,VatSum,DocTotal,LineNum,ItemCode,Dscription,Quantity,UomCode,Price,DiscPrcnt,VatGroup,LineTotal";

function row(fields: Record<string, string>): string {
  const order = CSV_HEADER.split(",");
  return order.map((h) => fields[h] ?? "").join(",");
}

describe("Milestone 5: csv.ts -- parsing, mapping, grouping", () => {
  it("scenario 1 precursor: parses a well-formed CSV for preview", () => {
    const csv = [
      CSV_HEADER,
      row({ DocEntry: "501", DocNum: "90001", CardCode: "DEMO-CUST-001", Quantity: "20.0000" }),
    ].join("\n");

    const result = parseInvoiceCsvForPreview(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.sourceHeaders).toContain("DocNum");
      expect(result.preview.totalDataRows).toBe(1);
    }
  });

  it("suggests a sensible column mapping from real SAP B1-style headers", () => {
    const suggested = suggestColumnMapping(CSV_HEADER.split(","));
    expect(suggested.docNum).toBe("DocNum");
    expect(suggested.customerCode).toBe("CardCode");
    expect(suggested.itemCode).toBe("ItemCode");
    expect(suggested.quantity).toBe("Quantity");
  });

  it("validateColumnMapping rejects a mapping missing a required field", () => {
    const incomplete = { ...FULL_MAPPING, quantity: null };
    const result = validateColumnMapping(incomplete, CSV_HEADER.split(","));
    expect(result.ok).toBe(false);
  });

  it("validateColumnMapping rejects the same column mapped twice", () => {
    const clashing = { ...FULL_MAPPING, customerName: FULL_MAPPING.docNum };
    const result = validateColumnMapping(clashing, CSV_HEADER.split(","));
    expect(result.ok).toBe(false);
  });

  it("scenario 2: a row missing DocNum or a parseable quantity is rejected, not guessed", () => {
    const csv = [
      CSV_HEADER,
      row({ DocEntry: "501", DocNum: "", CardCode: "DEMO-CUST-001", ItemCode: "ABC", Quantity: "20" }), // missing DocNum
      row({ DocEntry: "502", DocNum: "90002", CardCode: "DEMO-CUST-001", ItemCode: "ABC", Quantity: "not-a-number" }), // bad quantity
      row({ DocEntry: "503", DocNum: "90003", CardCode: "DEMO-CUST-001", ItemCode: "ABC", Quantity: "" }), // missing quantity
    ].join("\n");

    const { rows, errors } = applyColumnMapping(csv, FULL_MAPPING);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(3);
    expect(errors[0]!.message).toMatch(/missing an invoice number/);
    expect(errors[1]!.message).toMatch(/not a valid number/);
    expect(errors[2]!.message).toMatch(/missing a quantity/);
  });

  it("scenario 19: accepts decimal quantities up to 4 places and preserves them verbatim", () => {
    const csv = [CSV_HEADER, row({ DocEntry: "501", DocNum: "90001", CardCode: "DEMO-CUST-001", ItemCode: "ABC", Quantity: "12.3456" })].join("\n");
    const { rows, errors } = applyColumnMapping(csv, FULL_MAPPING);
    expect(errors).toHaveLength(0);
    expect(rows[0]!.quantity).toBe("12.3456");
  });

  it("groups flat rows into one header + N lines by DocEntry, and derives isCancelledOrReversed from status text", () => {
    const csv = [
      CSV_HEADER,
      row({ DocEntry: "501", DocNum: "90001", CardCode: "DEMO-CUST-001", DocStatus: "Open", ItemCode: "ABC", Quantity: "10", LineNum: "0" }),
      row({ DocEntry: "501", DocNum: "90001", CardCode: "DEMO-CUST-001", DocStatus: "Open", ItemCode: "XYZ", Quantity: "5", LineNum: "1" }),
      row({ DocEntry: "502", DocNum: "90002", CardCode: "DEMO-CUST-001", DocStatus: "Cancelled", ItemCode: "ABC", Quantity: "3", LineNum: "0" }),
    ].join("\n");

    const { rows } = applyColumnMapping(csv, FULL_MAPPING);
    const groups = groupIntoInvoices(rows);
    expect(groups).toHaveLength(2);

    const invoice501 = groups.find((g) => g.docEntry === "501")!;
    expect(invoice501.lines).toHaveLength(2);
    expect(invoice501.isCancelledOrReversed).toBe(false);

    const invoice502 = groups.find((g) => g.docEntry === "502")!;
    expect(invoice502.isCancelledOrReversed).toBe(true);
  });

  it("groups by DocNum when DocEntry is absent from the export", () => {
    const headerNoDocEntry = CSV_HEADER.replace("DocEntry,", "");
    const fields = { DocNum: "90010", CardCode: "DEMO-CUST-001", ItemCode: "ABC", Quantity: "10" } as Record<string, string>;
    const dataRow = headerNoDocEntry.split(",").map((h) => fields[h] ?? "").join(",");
    const csv = [headerNoDocEntry, dataRow].join("\n");
    const mappingNoDocEntry = { ...FULL_MAPPING, docEntry: null };
    const { rows } = applyColumnMapping(csv, mappingNoDocEntry);
    const groups = groupIntoInvoices(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupKey).toBe("docNum:90010");
  });
});

describe("Milestone 5: reconcile.ts -- quantity reconciliation", () => {
  it("scenario 8: authorized 20, invoiced 20 -> FULLY_INVOICED, remaining 0", () => {
    const result = computeOrderLineReconciliation("20.0000", "20.0000");
    expect(result?.status).toBe("FULLY_INVOICED");
    expect(result?.remainingQuantity).toBe("0.0000");
  });

  it("scenario 9: authorized 20, invoiced 12 -> PARTIALLY_INVOICED, remaining 8", () => {
    const result = computeOrderLineReconciliation("20.0000", "12.0000");
    expect(result?.status).toBe("PARTIALLY_INVOICED");
    expect(result?.remainingQuantity).toBe("8.0000");
  });

  it("scenario 10: authorized 20, invoiced 0 -> NOT_YET_INVOICED, remaining 20", () => {
    const result = computeOrderLineReconciliation("20.0000", "0.0000");
    expect(result?.status).toBe("NOT_YET_INVOICED");
    expect(result?.remainingQuantity).toBe("20.0000");
  });

  it("scenario 11: authorized 20, invoiced 23 -> OVER_INVOICED, remaining -3 (never clamped to zero)", () => {
    const result = computeOrderLineReconciliation("20.0000", "23.0000");
    expect(result?.status).toBe("OVER_INVOICED");
    expect(result?.remainingQuantity).toBe("-3.0000");
  });

  it("scenario 19: holds exact decimal arithmetic rather than floating-point approximation", () => {
    const result = computeOrderLineReconciliation("10.1000", "10.0999");
    expect(result?.status).toBe("PARTIALLY_INVOICED");
    expect(result?.remainingQuantity).toBe("0.0001");
  });

  it("never silently changes the authorized quantity -- the input is echoed back verbatim", () => {
    const result = computeOrderLineReconciliation("20.0000", "20.0000");
    expect(result?.authorizedQuantity).toBe("20.0000");
  });

  it("rejects an unparseable quantity rather than guessing", () => {
    expect(computeOrderLineReconciliation("abc", "1.0000")).toBeNull();
  });

  describe("deriveInvoiceReconciliationStatus -- invoice-header status, kept separate from order-line status", () => {
    it("every line UNMATCHED -> UNMATCHED", () => {
      const status = deriveInvoiceReconciliationStatus([{ matchStatus: "UNMATCHED" }, { matchStatus: "UNMATCHED" }], false);
      expect(status).toBe("UNMATCHED");
    });

    it("a mix of matched and unmatched -> PARTIALLY_MATCHED", () => {
      const status = deriveInvoiceReconciliationStatus([{ matchStatus: "AUTO_MATCHED" }, { matchStatus: "UNMATCHED" }], false);
      expect(status).toBe("PARTIALLY_MATCHED");
    });

    it("every line resolved, nothing flagged -> MATCHED", () => {
      const status = deriveInvoiceReconciliationStatus([{ matchStatus: "AUTO_MATCHED" }, { matchStatus: "CANNOT_LINK" }], false);
      expect(status).toBe("MATCHED");
    });

    it("scenario 11: a matched line that causes over-invoicing forces RECONCILIATION_REQUIRED, not MATCHED", () => {
      const status = deriveInvoiceReconciliationStatus([{ matchStatus: "AUTO_MATCHED", causesOverInvoicing: true }], false);
      expect(status).toBe("RECONCILIATION_REQUIRED");
    });

    it("scenario 17: isCancelledOrReversed always wins over the lines' own state", () => {
      const status = deriveInvoiceReconciliationStatus([{ matchStatus: "AUTO_MATCHED" }], true);
      expect(status).toBe("CANCELLED_REVERSED");
    });

    it("no lines at all -> RECONCILIATION_REQUIRED (never silently MATCHED)", () => {
      expect(deriveInvoiceReconciliationStatus([], false)).toBe("RECONCILIATION_REQUIRED");
    });
  });
});

describe("Milestone 5: matching.ts -- conservative automatic invoice-line matching", () => {
  function candidate(orderId: string, referenceMatches: boolean, lines: { orderLineId: string; sapItemCode: string | null; authorizedQuantity: string; alreadyInvoicedQuantity: string }[]): MatchCandidateOrder {
    return { orderId, referenceMatches, lines: lines.map((l) => ({ orderId, ...l })) };
  }

  it("scenario 7: matches by exact SAP item code, never by description similarity (no description is even read)", () => {
    const candidates = [candidate("order-1", false, [{ orderLineId: "line-1", sapItemCode: "ABC-100", authorizedQuantity: "20.0000", alreadyInvoicedQuantity: "0.0000" }])];
    const result = matchInvoiceLineToOrder("ABC-100", "5.0000", candidates);
    expect(result?.orderLineId).toBe("line-1");
    expect(result?.causesOverInvoicing).toBe(false);
  });

  it("scenario 15: more than one qualifying candidate line -> null (manual reconciliation queue), never a guess", () => {
    const candidates = [
      candidate("order-1", false, [{ orderLineId: "line-1", sapItemCode: "ABC-100", authorizedQuantity: "20.0000", alreadyInvoicedQuantity: "0.0000" }]),
      candidate("order-2", false, [{ orderLineId: "line-2", sapItemCode: "ABC-100", authorizedQuantity: "10.0000", alreadyInvoicedQuantity: "0.0000" }]),
    ];
    expect(matchInvoiceLineToOrder("ABC-100", "5.0000", candidates)).toBeNull();
  });

  it("scenario 13: an explicit order reference narrows matching to that order alone, resolving what would otherwise be ambiguous", () => {
    const candidates = [
      candidate("order-1", true, [{ orderLineId: "line-1", sapItemCode: "ABC-100", authorizedQuantity: "20.0000", alreadyInvoicedQuantity: "0.0000" }]),
      candidate("order-2", false, [{ orderLineId: "line-2", sapItemCode: "ABC-100", authorizedQuantity: "10.0000", alreadyInvoicedQuantity: "0.0000" }]),
    ];
    const result = matchInvoiceLineToOrder("ABC-100", "5.0000", candidates);
    expect(result?.orderId).toBe("order-1");
    expect(result?.orderLineId).toBe("line-1");
  });

  it("never matches an order line with no remaining capacity (already fully invoiced)", () => {
    const candidates = [candidate("order-1", false, [{ orderLineId: "line-1", sapItemCode: "ABC-100", authorizedQuantity: "20.0000", alreadyInvoicedQuantity: "20.0000" }])];
    expect(matchInvoiceLineToOrder("ABC-100", "5.0000", candidates)).toBeNull();
  });

  it("scenario 11: a match whose own quantity exceeds remaining capacity still completes, flagged causesOverInvoicing", () => {
    const candidates = [candidate("order-1", false, [{ orderLineId: "line-1", sapItemCode: "ABC-100", authorizedQuantity: "20.0000", alreadyInvoicedQuantity: "15.0000" }])];
    const result = matchInvoiceLineToOrder("ABC-100", "10.0000", candidates); // remaining 5, invoicing 10
    expect(result?.orderLineId).toBe("line-1");
    expect(result?.causesOverInvoicing).toBe(true);
  });

  it("an invoice line with no SAP item code at all is never matched", () => {
    const candidates = [candidate("order-1", false, [{ orderLineId: "line-1", sapItemCode: null, authorizedQuantity: "20.0000", alreadyInvoicedQuantity: "0.0000" }])];
    expect(matchInvoiceLineToOrder(null, "5.0000", candidates)).toBeNull();
  });

  it("a different SAP item code with similar text is never treated as the same product", () => {
    const candidates = [candidate("order-1", false, [{ orderLineId: "line-1", sapItemCode: "ABC-100", authorizedQuantity: "20.0000", alreadyInvoicedQuantity: "0.0000" }])];
    expect(matchInvoiceLineToOrder("ABC-100X", "5.0000", candidates)).toBeNull();
  });
});
