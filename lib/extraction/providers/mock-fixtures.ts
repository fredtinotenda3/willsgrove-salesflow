/**
 * Milestone 2A. Controlled, deterministic fixtures for MockExtractionProvider
 * (lib/extraction/providers/mock.ts) -- used when a PDF/image document
 * can't be meaningfully parsed without a real AI call, so a canned,
 * clearly-labelled response stands in for one. Each fixture's item codes
 * and descriptions are drawn from the real Milestone 1 catalogue/invoice
 * facts already confirmed in this project (item 0228 = Baby Marrow 250G
 * Punnet, unit PNT; the other Baby Marrow variants named in the Milestone
 * 2 brief), never invented SAP data -- but the DOCUMENT itself (a PO
 * "from" a named customer on a given date) is synthetic, for testing
 * only, and must never be presented as a real Willsgrove order.
 */
import { PO_EXTRACTION_SCHEMA_VERSION, type ExtractionResult } from "@/lib/extraction/schema";

export const MOCK_FIXTURE_KEYS = [
  "default",
  "baby-marrow-variants",
  "missing-quantity",
  "unrelated-document",
] as const;

export type MockFixtureKey = (typeof MOCK_FIXTURE_KEYS)[number];

export function isMockFixtureKey(value: string): value is MockFixtureKey {
  return (MOCK_FIXTURE_KEYS as readonly string[]).includes(value);
}

const FIXTURES: Record<MockFixtureKey, ExtractionResult> = {
  default: {
    schemaVersion: PO_EXTRACTION_SCHEMA_VERSION,
    classification: "CUSTOMER_PO",
    header: {
      customerNameRaw: "TM Chinhoyi North",
      storeOrBranchRaw: "Chinhoyi North",
      customerPoNumber: "MOCK-PO-0001",
      poDate: "2026-11-06",
      requestedDeliveryDate: null,
      deliveryAddressRaw: null,
      currencyRaw: "USD",
      senderInfoRaw: null,
    },
    lines: [
      {
        lineNumber: 1,
        originalDescription: "Baby Marrow small punnet",
        extractedQuantity: "10",
        extractedUnit: "PNT",
        customerProvidedUnitPrice: null,
        sourcePageOrImageRef: "page-1",
        confidence: 0.9,
        warnings: [],
      },
    ],
  },

  // Exercises the exact ambiguity the Milestone 2 brief calls out by
  // name: four distinct real SAP items that must never be merged.
  "baby-marrow-variants": {
    schemaVersion: PO_EXTRACTION_SCHEMA_VERSION,
    classification: "CUSTOMER_PO",
    header: {
      customerNameRaw: "TM Chinhoyi North",
      storeOrBranchRaw: "Chinhoyi North",
      customerPoNumber: "MOCK-PO-0002",
      poDate: "2026-11-06",
      requestedDeliveryDate: null,
      deliveryAddressRaw: null,
      currencyRaw: "USD",
      senderInfoRaw: null,
    },
    lines: [
      {
        lineNumber: 1,
        originalDescription: "Baby Marrow small punnet",
        extractedQuantity: "10",
        extractedUnit: "PNT",
        customerProvidedUnitPrice: null,
        sourcePageOrImageRef: "page-1",
        confidence: 0.75,
        warnings: ["Several SAP items match this description closely -- review before confirming."],
      },
      {
        lineNumber: 2,
        originalDescription: "Baby Marrow 500g",
        extractedQuantity: "5",
        extractedUnit: "EA",
        customerProvidedUnitPrice: null,
        sourcePageOrImageRef: "page-1",
        confidence: 0.8,
        warnings: [],
      },
      {
        lineNumber: 3,
        originalDescription: "Baby Marrow loose by the kg",
        extractedQuantity: "8",
        extractedUnit: "KG",
        customerProvidedUnitPrice: null,
        sourcePageOrImageRef: "page-1",
        confidence: 0.7,
        warnings: [],
      },
      {
        lineNumber: 4,
        originalDescription: "Baby Marrow sliced 250g",
        extractedQuantity: "6",
        extractedUnit: "PNT",
        customerProvidedUnitPrice: null,
        sourcePageOrImageRef: "page-1",
        confidence: 0.72,
        warnings: ["Wording is close to the plain 250g punnet line above -- review before confirming."],
      },
    ],
  },

  "missing-quantity": {
    schemaVersion: PO_EXTRACTION_SCHEMA_VERSION,
    classification: "CUSTOMER_PO",
    header: {
      customerNameRaw: "TM Chinhoyi North",
      storeOrBranchRaw: "Chinhoyi North",
      customerPoNumber: "MOCK-PO-0003",
      poDate: "2026-11-06",
      requestedDeliveryDate: null,
      deliveryAddressRaw: null,
      currencyRaw: "USD",
      senderInfoRaw: null,
    },
    lines: [
      {
        lineNumber: 1,
        originalDescription: "Baby Marrow small punnet, usual amount",
        extractedQuantity: null,
        extractedUnit: null,
        customerProvidedUnitPrice: null,
        sourcePageOrImageRef: "page-1",
        confidence: 0.4,
        warnings: ["No quantity stated on the original document -- flag for manual entry, never guess."],
      },
    ],
  },

  "unrelated-document": {
    schemaVersion: PO_EXTRACTION_SCHEMA_VERSION,
    classification: "UNRELATED",
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
    lines: [],
  },
};

export function getMockFixture(key: MockFixtureKey): ExtractionResult {
  // Structured clone so a caller mutating the returned object (e.g. a
  // test asserting on it then editing it) can never corrupt the shared
  // fixture for a later call.
  return structuredClone(FIXTURES[key]);
}
