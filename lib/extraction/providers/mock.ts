/**
 * Milestone 2A. Deterministic mock extraction provider -- works with no
 * API key and no external call, for tests and local development (Milestone
 * 2 brief, section 3B).
 *
 * - PDF/image input: returns a controlled fixture (lib/extraction/providers/mock-fixtures.ts).
 *   A mock genuinely cannot read file bytes the way a real vision model
 *   does, so pretending to extract one would be dishonest; a canned,
 *   clearly-labelled fixture is the honest stand-in. Pass `fixtureKey` to
 *   pick which one; defaults to "default".
 * - Pasted text input (EMAIL/WHATSAPP channels): does real, if simple,
 *   deterministic line parsing -- see parsePastedText below -- rather
 *   than always returning a fixture, since plain text is genuinely
 *   parseable without an AI call for the common "qty x description"
 *   shapes this heuristic covers. Lines it can't confidently split still
 *   come through (original text preserved) with a warning and a null
 *   quantity, never a guessed number.
 *
 * Every result is still validated against the shared schema
 * (lib/extraction/schema.ts) by the caller (lib/po-intake.ts) exactly like
 * the real provider's output -- this file does not get a weaker bar.
 */
import { PO_EXTRACTION_SCHEMA_VERSION, type ExtractionLine } from "@/lib/extraction/schema";
import type { ExtractionInput, ExtractionProviderImpl, ExtractionProviderOutcome } from "@/lib/extraction/provider";
import { getMockFixture, isMockFixtureKey, type MockFixtureKey } from "@/lib/extraction/providers/mock-fixtures";

// Matches a leading quantity token in a pasted line, in either order:
// "10 x Baby Marrow 250g", "10 Baby Marrow 250g", "Baby Marrow 250g x10",
// "Baby Marrow 250g x 10". Captures the quantity and leaves the rest as
// the description either side of it.
const LEADING_QTY_PATTERN = /^(\d{1,6}(?:\.\d{1,2})?)\s*x?\s+(.+)$/i;
const TRAILING_QTY_PATTERN = /^(.+?)\s*x\s*(\d{1,6}(?:\.\d{1,2})?)$/i;

function parseOneLine(raw: string, lineNumber: number): ExtractionLine {
  const text = raw.trim();

  const leading = LEADING_QTY_PATTERN.exec(text);
  if (leading) {
    return {
      lineNumber,
      originalDescription: text,
      extractedQuantity: leading[1]!,
      extractedUnit: null,
      customerProvidedUnitPrice: null,
      sourcePageOrImageRef: null,
      confidence: 0.6,
      warnings: [],
    };
  }

  const trailing = TRAILING_QTY_PATTERN.exec(text);
  if (trailing) {
    return {
      lineNumber,
      originalDescription: text,
      extractedQuantity: trailing[2]!,
      extractedUnit: null,
      customerProvidedUnitPrice: null,
      sourcePageOrImageRef: null,
      confidence: 0.6,
      warnings: [],
    };
  }

  // No recognizable quantity token -- preserve the line as-is rather than
  // guessing a quantity, per "never invent a quantity."
  return {
    lineNumber,
    originalDescription: text,
    extractedQuantity: null,
    extractedUnit: null,
    customerProvidedUnitPrice: null,
    sourcePageOrImageRef: null,
    confidence: 0.3,
    warnings: ["Could not identify a quantity in this line -- flag for manual entry."],
  };
}

/**
 * Splits pasted free text into non-empty lines and best-effort-parses
 * each as one order line. Exported separately from the provider class so
 * it's directly unit-testable without going through the provider
 * interface.
 */
export function parsePastedText(text: string): ExtractionLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, index) => parseOneLine(line, index + 1));
}

export type MockExtractOptions = {
  fixtureKey?: string;
};

export class MockExtractionProvider implements ExtractionProviderImpl {
  readonly providerName = "MOCK" as const;

  constructor(private readonly options: MockExtractOptions = {}) {}

  async extract(input: ExtractionInput): Promise<ExtractionProviderOutcome> {
    const startedAt = Date.now();

    if (input.kind === "text") {
      const lines = parsePastedText(input.text);
      return {
        ok: true,
        model: null,
        processingTimeMs: Date.now() - startedAt,
        rawResponse: { mock: true, source: "parsePastedText", inputLength: input.text.length },
        result: {
          schemaVersion: PO_EXTRACTION_SCHEMA_VERSION,
          classification: lines.length > 0 ? "CUSTOMER_PO" : "UNRELATED",
          header: {
            customerNameRaw: null,
            storeOrBranchRaw: null,
            customerPoNumber: null,
            poDate: null,
            requestedDeliveryDate: null,
            deliveryAddressRaw: null,
            currencyRaw: null,
            senderInfoRaw: null,
          },
          lines,
        },
      };
    }

    const requestedKey = this.options.fixtureKey;
    const fixtureKey: MockFixtureKey = requestedKey && isMockFixtureKey(requestedKey) ? requestedKey : "default";
    const result = getMockFixture(fixtureKey);

    return {
      ok: true,
      model: null,
      processingTimeMs: Date.now() - startedAt,
      rawResponse: { mock: true, source: "fixture", fixtureKey },
      result,
    };
  }
}
