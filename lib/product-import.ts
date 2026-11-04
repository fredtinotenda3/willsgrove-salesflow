import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SapProductRow } from "@/lib/sap-product-csv";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const LOOKUP_CHUNK_SIZE = 1000;
const CREATE_CHUNK_SIZE = 1000;
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
}

export async function executeProductImport(
  plan: ProductImportPlan,
  fileName: string
): Promise<ProductImportResult> {
  const importedAt = new Date();
  const importId = randomUUID();

  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (let i = 0; i < plan.newProducts.length; i += CREATE_CHUNK_SIZE) {
    const chunk = plan.newProducts.slice(i, i + CREATE_CHUNK_SIZE);

    operations.push(
      prisma.product.createMany({
        data: chunk.map((product) => ({
          sapItemCode: product.sapItemCode,
          itemName: product.itemName,
          barcode: product.barcode,
          category: product.category,
          sourceData: product.sourceData,
          importedAt,
        })),
        skipDuplicates: true,
      })
    );
  }

  // Status is deliberately not touched: an import never activates or
  // deactivates a product.
  for (const change of plan.changedProducts) {
    operations.push(
      prisma.product.update({
        where: { sapItemCode: change.sapItemCode },
        data: {
          itemName: change.incoming.itemName,
          barcode: change.incoming.barcode,
          category: change.incoming.category,
          sourceData: change.incoming.sourceData,
          importedAt,
        },
      })
    );
  }

  const recordedChanges = plan.changedProducts
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

  operations.push(
    prisma.auditEvent.create({
      data: {
        actorId: null,
        action: "PRODUCT_IMPORT",
        entityType: "ProductImport",
        entityId: importId,
        afterData: {
          fileName,
          importedAt: importedAt.toISOString(),
          created: plan.newProducts.length,
          updated: plan.changedProducts.length,
          unchanged: plan.unchangedProducts.length,
          changesRecorded: recordedChanges.length,
          changesTruncated:
            plan.changedProducts.length > recordedChanges.length,
          changes: recordedChanges,
        },
      },
    })
  );

  const audit = await prisma.$transaction(operations);
  const auditEvent = audit[audit.length - 1] as { id: string };

  return {
    created: plan.newProducts.length,
    updated: plan.changedProducts.length,
    unchanged: plan.unchangedProducts.length,
    auditEventId: auditEvent.id,
  };
}