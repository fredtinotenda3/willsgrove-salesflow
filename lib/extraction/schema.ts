/**
 * Milestone 2A. The one versioned shape every extraction path (Anthropic
 * provider, mock provider, and the deterministic Excel/CSV parsers) must
 * produce, validated here before it is ever written to
 * ExtractionRun.extractedHeader/extractedLines.
 *
 * Versioning: PO_EXTRACTION_SCHEMA_VERSION is stored on every
 * ExtractionRun row (promptVersion). Bumping this constant when the shape
 * changes is deliberate -- it lets a later reader (Milestone 2B's
 * matching engine, or a support investigation) know which shape a given
 * historical row was validated against, without guessing from its
 * content.
 *
 * "Never invent a quantity, unit, product code, customer, price or date" /
 * "Missing information must remain null" (Milestone 2 brief, section 3):
 * every field below that a document might simply not state is nullable,
 * with no default other than null -- there is deliberately no fallback
 * value a provider could reach for instead of admitting it doesn't know.
 * lineNumber and originalDescription are the only two fields required on
 * a line, because a line that names neither a position nor any text at
 * all isn't a line -- it's nothing to review.
 */
import { z } from "zod";
import { isValidDateOnlyString } from "@/lib/dates";

export const PO_EXTRACTION_SCHEMA_VERSION = "po-extraction-v1";

// Decimal-as-string, same pattern and regex as lib/order-validation.ts's
// decimalString -- never a JS number, for the same "no floating point for
// money/quantity" reason. Nullable here (unlike order-validation.ts's
// version) because an extracted line may simply not state a quantity or
// price at all.
const nullableDecimalString = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, "Must be a positive decimal number with up to 4 decimal places.")
  .refine((value) => Number(value) > 0, "Must be greater than zero.")
  .nullable();

const nullableDateOnlyString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date in YYYY-MM-DD format.")
  .refine(isValidDateOnlyString, "Not a valid calendar date.")
  .nullable();

export const extractionClassificationValues = [
  "CUSTOMER_PO",
  "HANDWRITTEN_LIST",
  "CHAT_SCREENSHOT",
  "ORDER_SHEET",
  "PRICE_LIST",
  "DELIVERY_NOTE",
  "UNRELATED",
] as const;

export const extractionClassificationSchema = z.enum(extractionClassificationValues);

export type ExtractionClassification = z.infer<typeof extractionClassificationSchema>;

export const extractionLineSchema = z.object({
  lineNumber: z.number().int().positive(),

  // Preserved verbatim -- the same "never correct the customer's own
  // words" principle as OrderLine.originalProductDescription.
  originalDescription: z.string().trim().min(1).max(500),

  extractedQuantity: nullableDecimalString,
  extractedUnit: z.string().trim().max(20).nullable(),

  // Stored for traceability only. Per the pricing correction: SalesFlow
  // never computes, approves, or displays a selling price -- this field
  // exists purely so a price the customer happened to write on their own
  // PO isn't silently discarded, in case it's ever useful context during
  // review. Nothing in Milestone 2 reads it for a pricing decision.
  customerProvidedUnitPrice: nullableDecimalString,

  sourcePageOrImageRef: z.string().trim().max(100).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  warnings: z.array(z.string().trim().max(300)).max(20),
});

export type ExtractionLine = z.infer<typeof extractionLineSchema>;

export const extractionHeaderSchema = z.object({
  customerNameRaw: z.string().trim().max(200).nullable(),
  storeOrBranchRaw: z.string().trim().max(200).nullable(),
  customerPoNumber: z.string().trim().max(100).nullable(),
  poDate: nullableDateOnlyString,
  requestedDeliveryDate: nullableDateOnlyString,
  deliveryAddressRaw: z.string().trim().max(500).nullable(),
  currencyRaw: z.string().trim().max(10).nullable(),
  senderInfoRaw: z.string().trim().max(300).nullable(),
});

export type ExtractionHeader = z.infer<typeof extractionHeaderSchema>;

export const extractionResultSchema = z.object({
  schemaVersion: z.literal(PO_EXTRACTION_SCHEMA_VERSION),
  classification: extractionClassificationSchema,
  header: extractionHeaderSchema,
  // 500-line ceiling is a sanity bound, not a product limit -- the
  // Milestone 2 acceptance scenario targets 100 lines; nothing here
  // assumes or enforces that number specifically.
  lines: z.array(extractionLineSchema).max(500),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export type SchemaValidationResult =
  | { ok: true; result: ExtractionResult }
  | { ok: false; message: string; issues: z.ZodIssue[] };

/**
 * The one place every extraction path's raw output is validated before
 * being persisted. A provider that returns something that doesn't match
 * is a FAILED ExtractionRun, not a best-effort save of whatever came
 * back -- see lib/po-intake.ts.
 */
export function validateExtractionResult(candidate: unknown): SchemaValidationResult {
  const parsed = extractionResultSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Extraction output did not match the expected schema.",
      issues: parsed.error.issues,
    };
  }
  return { ok: true, result: parsed.data };
}
