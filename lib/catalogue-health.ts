// Milestone 1 (Master data from SAP), "Catalogue health report." Runs
// against the live Product table (real SAP items, already imported in
// Milestone 0), not a freshly-uploaded file -- this is a standing report
// an operator re-checks any time, not a one-shot import preview.
//
// Confirmed against the business's real 7,540-row export: 7 blank
// descriptions, 59 rows repeating an already-seen description (58
// distinct descriptions, 117 rows total in those groups), 999 codes at
// leading-zero risk, and item 8028 ("Deli Baby Marrow/kg") with "Deli" in
// its BARCODE column -- every number and example below is computed the
// same way those were, just against whatever is in the database at
// request time rather than a fixed file.
//
// Split into a pure function (analyzeCatalogueHealth, below) and a thin
// Prisma-fetching wrapper (computeCatalogueHealth, further down) on
// purpose: this sandbox's @prisma/client is a non-functional stub (see
// docs/milestones/PROGRESS.md's "Sandbox-only blocker"), so anything that
// calls prisma directly can't be unit-tested here. The pure function
// carries every line of actual logic and is exercised by
// tests/catalogue-health.test.ts against fixture data built from the
// business's real confirmed numbers above -- without needing a database
// connection, here or anywhere else.

export interface DuplicateDescriptionGroup {
  description: string;
  codes: string[];
}

export interface NonBarcodeValue {
  sapItemCode: string;
  itemName: string;
  rawValue: string;
}

export interface LeadingZeroCode {
  sapItemCode: string;
  itemName: string;
}

export interface CatalogueHealthReport {
  totalProducts: number;
  blankDescriptions: { sapItemCode: string; category: string | null }[];
  duplicateDescriptions: DuplicateDescriptionGroup[];
  duplicateDescriptionRowCount: number;
  nonBarcodeValues: NonBarcodeValue[];
  leadingZeroCodes: LeadingZeroCode[];
  leadingZeroCount: number;
  itemsWithoutUnit: number;
  itemsWithoutVatCode: number;
  generatedAt: string;
}

const LEADING_ZERO_PATTERN = /^0[0-9]+$/;

export interface ProductForHealthCheck {
  sapItemCode: string;
  itemName: string;
  barcode: string | null;
  category: string | null;
  sourceData: unknown;
  unitOfMeasure: string | null;
  vatCode: string | null;
}

export function analyzeCatalogueHealth(
  products: ProductForHealthCheck[]
): CatalogueHealthReport {
  const blankDescriptions: CatalogueHealthReport["blankDescriptions"] = [];
  const descriptionGroups = new Map<string, string[]>();
  const nonBarcodeValues: NonBarcodeValue[] = [];
  const leadingZeroCodes: LeadingZeroCode[] = [];
  let itemsWithoutUnit = 0;
  let itemsWithoutVatCode = 0;

  for (const product of products) {
    if (!product.itemName.trim()) {
      blankDescriptions.push({ sapItemCode: product.sapItemCode, category: product.category });
    } else {
      const key = product.itemName.trim();
      const existing = descriptionGroups.get(key);
      if (existing) {
        existing.push(product.sapItemCode);
      } else {
        descriptionGroups.set(key, [product.sapItemCode]);
      }
    }

    // barcode is null either because SAP genuinely has none, or because
    // the Milestone 0 import rejected a non-numeric value and kept it in
    // sourceData -- only the second case belongs in this report.
    if (product.barcode === null) {
      const raw =
        product.sourceData && typeof product.sourceData === "object" && !Array.isArray(product.sourceData)
          ? (product.sourceData as Record<string, unknown>).BARCODE
          : undefined;

      if (typeof raw === "string" && raw.trim() !== "") {
        nonBarcodeValues.push({
          sapItemCode: product.sapItemCode,
          itemName: product.itemName,
          rawValue: raw,
        });
      }
    }

    if (LEADING_ZERO_PATTERN.test(product.sapItemCode)) {
      leadingZeroCodes.push({ sapItemCode: product.sapItemCode, itemName: product.itemName });
    }

    if (!product.unitOfMeasure) itemsWithoutUnit += 1;
    if (!product.vatCode) itemsWithoutVatCode += 1;
  }

  const duplicateDescriptions: DuplicateDescriptionGroup[] = [];
  let duplicateDescriptionRowCount = 0;

  for (const [description, codes] of descriptionGroups) {
    if (codes.length > 1) {
      duplicateDescriptions.push({ description, codes });
      duplicateDescriptionRowCount += codes.length;
    }
  }

  duplicateDescriptions.sort((a, b) => b.codes.length - a.codes.length);

  return {
    totalProducts: products.length,
    blankDescriptions,
    duplicateDescriptions,
    duplicateDescriptionRowCount,
    nonBarcodeValues,
    leadingZeroCodes,
    leadingZeroCount: leadingZeroCodes.length,
    itemsWithoutUnit,
    itemsWithoutVatCode,
    generatedAt: new Date().toISOString(),
  };
}

export async function computeCatalogueHealth(): Promise<CatalogueHealthReport> {
  // Dynamic import, not a static top-of-file one: this sandbox's
  // @prisma/client stub throws when merely constructed (see
  // docs/milestones/PROGRESS.md), so a static `import { prisma } from
  // "@/lib/prisma"` here would crash `npm test` even for test files that
  // never call this function, the same reason
  // tests/orders-db.integration.test.ts does its Prisma imports this way.
  const { prisma } = await import("@/lib/prisma");

  const products = await prisma.product.findMany({
    where: { isDemo: false },
    select: {
      sapItemCode: true,
      itemName: true,
      barcode: true,
      category: true,
      sourceData: true,
      unitOfMeasure: true,
      vatCode: true,
    },
  });

  return analyzeCatalogueHealth(products);
}
