/** Shared shapes for the PO reading pipeline (text, PDF, spreadsheet, image). */

export type ParsedLine = {
  lineNumber: number;
  /** The line exactly as the customer wrote it (trimmed). */
  rawText: string;
  /** Product wording with quantity/unit noise removed ("2kg onions white" -> "onions white"). */
  description: string;
  /** Decimal string, or null when the document does not state one. */
  quantity: string | null;
  /** Canonical unit code (KG, PNT, EA ...), or null when not stated. */
  unit: string | null;
  /** Pack size written on the line ("125G", "1.5KG", "6S"), if any. */
  packSize: string | null;
  /** A weight/volume given with no multiplier ("Mangoes 2.5kg"): the quantity above is that measure, and may really mean "one pack of that size". */
  measureOnly: boolean;
  /** Price written on the customer's own document (never invented). */
  unitPrice: string | null;
  /** Customer's own item code if the document has a code column. */
  customerItemCode: string | null;
  confidence: number;
  warnings: string[];
};

export type ParsedHeader = {
  /** Ordered best-first: organisation / branch names found on the document. */
  customerNameCandidates: string[];
  poNumber: string | null;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
  deliveryAddress: string | null;
  currency: string | null;
};

export type ParseOutput = {
  mode: "table" | "text";
  header: ParsedHeader;
  lines: ParsedLine[];
  notes: string[];
};

export function emptyHeader(): ParsedHeader {
  return { customerNameCandidates: [], poNumber: null, orderDate: null, requestedDeliveryDate: null, deliveryAddress: null, currency: null };
}
