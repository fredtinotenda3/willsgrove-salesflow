import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ItemMasterRow } from "@/lib/sap-item-master-csv";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const LOOKUP_CHUNK_SIZE = 1000;
const AUDIT_CHANGE_LIMIT = 500;

export type CsvUploadResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; status: number; message: string };

export async function readItemMasterCsvUpload(
  formData: FormData
): Promise<CsvUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, status: 400, message: "Please select an item-master CSV file." };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { ok: false, status: 400, message: "Only CSV files are supported." };
  }
  if (file.size === 0) {
    return { ok: false, status: 400, message: "The selected CSV file is empty." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, status: 413, message: "The CSV file exceeds the 25 MB size limit." };
  }

  return { ok: true, fileName: file.name, csvText: await file.text() };
}

// `type` alias, not `interface` -- see the identical comment in
// lib/tax-code-import.ts. This value is embedded as-is (`before:
// change.current`) in the Json payload passed to AuditEvent.afterData
// below; a named `interface` of this exact shape fails Prisma's real
// InputJsonObject index-signature check, a `type` alias does not.
export type ExistingItemMasterSnapshot = {
  sapItemCode: string;
  unitOfMeasure: string | null;
  packSize: string | null;
  isVariableWeight: boolean;
  vatCode: string | null;
};

export interface ChangedItem {
  code: string;
  current: ExistingItemMasterSnapshot;
  incoming: ItemMasterRow;
}

export interface ItemMasterImportPlan {
  changedItems: ChangedItem[];
  unchangedItems: ItemMasterRow[];
  // Rows whose CODE does not match any existing Product -- this import
  // only extends products created by the Milestone 0 product import, so
  // these are never silently dropped: they are reported back for the
  // operator to investigate (likely a typo, or the product import hasn't
  // run yet for this code).
  unmatchedCodes: string[];
  // VAT codes referenced that aren't (yet) in the TaxCode table. Not
  // blocking -- Product.vatCode is stored either way -- but surfaced so
  // the operator knows to also run the tax-code import.
  unknownTaxCodes: string[];
}

export async function planItemMasterImport(
  rows: ItemMasterRow[]
): Promise<ItemMasterImportPlan> {
  const existingByCode = new Map<string, ExistingItemMasterSnapshot>();

  for (let i = 0; i < rows.length; i += LOOKUP_CHUNK_SIZE) {
    const codes = rows.slice(i, i + LOOKUP_CHUNK_SIZE).map((r) => r.code);

    const existing = await prisma.product.findMany({
      where: { sapItemCode: { in: codes } },
      select: {
        sapItemCode: true,
        unitOfMeasure: true,
        packSize: true,
        isVariableWeight: true,
        vatCode: true,
      },
    });

    for (const product of existing) {
      existingByCode.set(product.sapItemCode, {
        sapItemCode: product.sapItemCode,
        unitOfMeasure: product.unitOfMeasure,
        packSize: product.packSize,
        isVariableWeight: product.isVariableWeight,
        vatCode: product.vatCode,
      });
    }
  }

  const knownTaxCodes = new Set<string>();
  const taxCodesReferenced = [
    ...new Set(rows.map((r) => r.vatCode).filter((v): v is string => v !== null)),
  ];

  for (let i = 0; i < taxCodesReferenced.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = taxCodesReferenced.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.taxCode.findMany({
      where: { code: { in: chunk } },
      select: { code: true },
    });
    for (const t of found) knownTaxCodes.add(t.code);
  }

  const changedItems: ChangedItem[] = [];
  const unchangedItems: ItemMasterRow[] = [];
  const unmatchedCodes: string[] = [];
  const unknownTaxCodes = taxCodesReferenced.filter((code) => !knownTaxCodes.has(code));

  for (const row of rows) {
    const existing = existingByCode.get(row.code);

    if (!existing) {
      unmatchedCodes.push(row.code);
      continue;
    }

    const hasChanges =
      existing.unitOfMeasure !== row.unitOfMeasure ||
      existing.packSize !== row.packSize ||
      existing.isVariableWeight !== row.isVariableWeight ||
      existing.vatCode !== row.vatCode;

    if (hasChanges) {
      changedItems.push({ code: row.code, current: existing, incoming: row });
    } else {
      unchangedItems.push(row);
    }
  }

  return { changedItems, unchangedItems, unmatchedCodes, unknownTaxCodes };
}

export interface ItemMasterImportResult {
  updated: number;
  unchanged: number;
  unmatched: number;
  auditEventId: string;
}

export async function executeItemMasterImport(
  plan: ItemMasterImportPlan,
  fileName: string
): Promise<ItemMasterImportResult> {
  const importId = randomUUID();
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (const change of plan.changedItems) {
    operations.push(
      prisma.product.update({
        where: { sapItemCode: change.code },
        data: {
          unitOfMeasure: change.incoming.unitOfMeasure,
          packSize: change.incoming.packSize,
          isVariableWeight: change.incoming.isVariableWeight,
          vatCode: change.incoming.vatCode,
        },
      })
    );
  }

  const recordedChanges = plan.changedItems.slice(0, AUDIT_CHANGE_LIMIT).map((change) => ({
    code: change.code,
    before: change.current,
    after: {
      unitOfMeasure: change.incoming.unitOfMeasure,
      packSize: change.incoming.packSize,
      isVariableWeight: change.incoming.isVariableWeight,
      vatCode: change.incoming.vatCode,
    },
  }));

  operations.push(
    prisma.auditEvent.create({
      data: {
        actorId: null,
        action: "ITEM_MASTER_IMPORT",
        entityType: "ItemMasterImport",
        entityId: importId,
        afterData: {
          fileName,
          updated: plan.changedItems.length,
          unchanged: plan.unchangedItems.length,
          unmatchedCount: plan.unmatchedCodes.length,
          unmatchedCodes: plan.unmatchedCodes.slice(0, AUDIT_CHANGE_LIMIT),
          unknownTaxCodes: plan.unknownTaxCodes,
          changesRecorded: recordedChanges.length,
          changesTruncated: plan.changedItems.length > recordedChanges.length,
          changes: recordedChanges,
        },
      },
    })
  );

  const audit = await prisma.$transaction(operations);
  const auditEvent = audit[audit.length - 1] as { id: string };

  return {
    updated: plan.changedItems.length,
    unchanged: plan.unchangedItems.length,
    unmatched: plan.unmatchedCodes.length,
    auditEventId: auditEvent.id,
  };
}
