import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { SapProductRow } from "@/lib/sap-product-csv";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const LOOKUP_CHUNK_SIZE = 1000;
const AUDIT_CHANGE_LIMIT = 500;

export type CsvUploadResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; status: number; message: string };

export async function readSapCsvUpload(
  formData: FormData
): Promise<CsvUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return {
      ok: false,
      status: 400,
      message: "Please select a SAP product CSV file.",
    };
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return {
      ok: false,
      status: 400,
      message: "Only CSV files are supported.",
    };
  }

  if (file.size === 0) {
    return {
      ok: false,
      status: 400,
      message: "The selected CSV file is empty.",
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      status: 413,
      message: "The CSV file exceeds the 25 MB size limit.",
    };
  }

  return {
    ok: true,
    fileName: file.name,
    csvText: await file.text(),
  };
}

export type ExistingProductSnapshot = {
  sapItemCode: string;
  itemName: string;
  barcode: string | null;
  category: string | null;
};

export interface ChangedProduct {
  sapItemCode: string;
  current: ExistingProductSnapshot;
  incoming: SapProductRow;
}

export interface ProductImportPlan {
  newProducts: SapProductRow[];
  changedProducts: ChangedProduct[];
  unchangedProducts: SapProductRow[];
}

export async function planProductImport(
  products: SapProductRow[]
): Promise<ProductImportPlan> {
  const existingByCode = new Map<string, ExistingProductSnapshot>();

  for (let i = 0; i < products.length; i += LOOKUP_CHUNK_SIZE) {
    const codes = products
      .slice(i, i + LOOKUP_CHUNK_SIZE)
      .map((product) => product.sapItemCode);

    const existingProducts = await prisma.product.findMany({
      where: { sapItemCode: { in: codes } },
      select: {
        sapItemCode: true,
        itemName: true,
        barcode: true,
        category: true,
      },
    });

    for (const existing of existingProducts) {
      existingByCode.set(existing.sapItemCode, existing);
    }
  }

  const newProducts: SapProductRow[] = [];
  const changedProducts: ChangedProduct[] = [];
  const unchangedProducts: SapProductRow[] = [];

  for (const product of products) {
    const existing = existingByCode.get(product.sapItemCode);

    if (!existing) {
      newProducts.push(product);
      continue;
    }

    const hasChanges =
      existing.itemName !== product.itemName ||
      existing.barcode !== product.barcode ||
      existing.category !== product.category;

    if (hasChanges) {
      changedProducts.push({
        sapItemCode: product.sapItemCode,
        current: existing,
        incoming: product,
      });
    } else {
      unchangedProducts.push(product);
    }
  }

  return { newProducts, changedProducts, unchangedProducts };
}

export interface ProductImportResult {
  created: number;
  updated: number;
  unchanged: number;
  auditEventId: string;
  /** True when a chunk failed after earlier chunks had already committed. */
  partial: boolean;
  partialReason?: string;
}

// Real-world incident fix: the real items-import.csv has 7,540 rows.
// executeProductImport USED TO queue every createMany chunk, every update
// and the audit event into ONE array-form prisma.$transaction([...]) with
// Prisma's default 5s timeout. Against a remote Postgres (Neon) that
// batch outlived the timeout, the server closed the connection
// ("Error in PostgreSQL connection: Closed") and the import never
// completed, leaving the confirm button spinning. The customer and
// price-list importers already fixed the same failure; this applies the
// same pattern:
//
//  * New products go in with createMany in bounded chunks. Each chunk is
//    one SQL statement and atomic on its own, so no database transaction
//    is ever held open across the file.
//  * Changed products are updated in small interactive transactions.
//    (The array form is avoided on purpose: lib/prisma.ts exports an
//    extended client, a documented source of batch-transaction
//    incompatibility.)
//  * The audit event is written after the fact so it records what was
//    actually committed.
//
// Trade-off: the import is no longer all-or-nothing across the whole
// file. It stays safe to retry: planProductImport detects products that
// already exist, and `skipDuplicates` guards a concurrent run, so
// re-uploading the same file finishes the remainder and never duplicates
// or touches Product.status.
const NEW_PRODUCT_CREATE_MANY_CHUNK_SIZE = 500;
const CHANGED_PRODUCT_UPDATE_CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function executeProductImport(
  plan: ProductImportPlan,
  fileName: string
): Promise<ProductImportResult> {
  const importedAt = new Date();
  const importId = randomUUID();

  let created = 0;
  const appliedChanges: ChangedProduct[] = [];
  let partialReason: string | undefined;

  try {
    for (const batch of chunk(plan.newProducts, NEW_PRODUCT_CREATE_MANY_CHUNK_SIZE)) {
      const result = await prisma.product.createMany({
        data: batch.map((product) => ({
          sapItemCode: product.sapItemCode,
          itemName: product.itemName,
          barcode: product.barcode,
          category: product.category,
          sourceData: product.sourceData,
          importedAt,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }

    // Status is deliberately not touched: an import never activates or
    // deactivates a product.
    for (const batch of chunk(plan.changedProducts, CHANGED_PRODUCT_UPDATE_CHUNK_SIZE)) {
      await prisma.$transaction(
        async (tx) => {
          for (const change of batch) {
            await tx.product.update({
              where: { sapItemCode: change.sapItemCode },
              data: {
                itemName: change.incoming.itemName,
                barcode: change.incoming.barcode,
                category: change.incoming.category,
                sourceData: change.incoming.sourceData,
                importedAt,
              },
            });
          }
        },
        { maxWait: 10000, timeout: 20000 }
      );
      appliedChanges.push(...batch);
    }
  } catch (error) {
    partialReason =
      error instanceof Error
        ? error.message
        : "An unexpected error interrupted the import.";
    console.error("SAP product import interrupted:", error);
  }

  const recordedChanges = appliedChanges
    .slice(0, AUDIT_CHANGE_LIMIT)
    .map((change) => ({
      sapItemCode: change.sapItemCode,
      before: change.current,
      after: {
        sapItemCode: change.incoming.sapItemCode,
        itemName: change.incoming.itemName,
        barcode: change.incoming.barcode,
        category: change.incoming.category,
      },
    }));

  const auditEvent = await prisma.auditEvent.create({
    data: {
      actorId: null,
      action: "PRODUCT_IMPORT",
      entityType: "ProductImport",
      entityId: importId,
      afterData: {
        fileName,
        importedAt: importedAt.toISOString(),
        created,
        updated: appliedChanges.length,
        unchanged: plan.unchangedProducts.length,
        plannedCreates: plan.newProducts.length,
        plannedUpdates: plan.changedProducts.length,
        changesRecorded: recordedChanges.length,
        changesTruncated: appliedChanges.length > recordedChanges.length,
        changes: recordedChanges,
        partial: partialReason !== undefined,
        partialReason: partialReason ?? null,
      },
    },
    select: { id: true },
  });

  return {
    created,
    updated: appliedChanges.length,
    unchanged: plan.unchangedProducts.length,
    auditEventId: auditEvent.id,
    partial: partialReason !== undefined,
    partialReason,
  };
}
