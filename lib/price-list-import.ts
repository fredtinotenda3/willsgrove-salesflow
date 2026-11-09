import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PriceListEntryRow } from "@/lib/sap-price-list-csv";
import { dateOnlyStringToUtcDate } from "@/lib/dates";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const LOOKUP_CHUNK_SIZE = 1000;
const AUDIT_CHANGE_LIMIT = 500;

export type CsvUploadResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; status: number; message: string };

export async function readPriceListCsvUpload(formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, status: 400, message: "Please select a price-list CSV file." };
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
// lib/tax-code-import.ts. plan.changedLists carries this wholesale as
// `incoming: ListDefinition`, and that array is embedded as-is
// (`listChanges: recordedListChanges`) in the Json payload passed to
// AuditEvent.afterData below; a named `interface` of this exact shape
// fails Prisma's real InputJsonObject index-signature check, a `type`
// alias does not.
type ListDefinition = {
  code: string;
  name: string;
  currencyCode: string;
};

interface EntryKey {
  priceListCode: string;
  itemCode: string;
  validFrom: string;
}

function entryKey(k: EntryKey): string {
  return `${k.priceListCode}\u0000${k.itemCode}\u0000${k.validFrom}`;
}

export interface NewEntry {
  row: PriceListEntryRow;
}

export interface ChangedEntry {
  key: EntryKey;
  entryId: string;
  current: { unitPrice: string; validTo: string | null };
  incoming: PriceListEntryRow;
}

export interface PriceListImportPlan {
  newLists: ListDefinition[];
  changedLists: { code: string; current: { name: string; currencyCode: string }; incoming: ListDefinition }[];
  newEntries: NewEntry[];
  changedEntries: ChangedEntry[];
  unchangedEntryCount: number;
  // Item codes referenced that don't (yet) match a Product. Not blocking --
  // the entry is still imported, with sapItemCodeSnapshot preserved and
  // productId left null until the product exists -- but surfaced so the
  // operator knows to also run the product/item-master import.
  unmatchedItemCodes: string[];
}

export async function planPriceListImport(rows: PriceListEntryRow[]): Promise<PriceListImportPlan> {
  const listDefinitionsByCode = new Map<string, ListDefinition>();
  for (const row of rows) {
    if (!listDefinitionsByCode.has(row.priceListCode)) {
      listDefinitionsByCode.set(row.priceListCode, {
        code: row.priceListCode,
        name: row.priceListName,
        currencyCode: row.currencyCode,
      });
    }
  }

  const listCodes = [...listDefinitionsByCode.keys()];
  const existingLists = await prisma.priceList.findMany({
    where: { code: { in: listCodes } },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
  const existingListByCode = new Map(existingLists.map((l) => [l.code, l]));

  const newLists: ListDefinition[] = [];
  const changedLists: PriceListImportPlan["changedLists"] = [];

  for (const def of listDefinitionsByCode.values()) {
    const existing = existingListByCode.get(def.code);
    if (!existing) {
      newLists.push(def);
    } else if (existing.name !== def.name || existing.currencyCode !== def.currencyCode) {
      changedLists.push({
        code: def.code,
        current: { name: existing.name, currencyCode: existing.currencyCode },
        incoming: def,
      });
    }
  }

  const itemCodes = [...new Set(rows.map((r) => r.itemCode))];
  const productByCode = new Map<string, { id: string }>();

  for (let i = 0; i < itemCodes.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = itemCodes.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.product.findMany({
      where: { sapItemCode: { in: chunk } },
      select: { id: true, sapItemCode: true },
    });
    for (const p of found) productByCode.set(p.sapItemCode, { id: p.id });
  }

  const unmatchedItemCodes = itemCodes.filter((code) => !productByCode.has(code));

  // Existing entries, looked up for every list this file touches (both
  // already-existing lists and ones about to be created have no prior
  // entries, so only existing lists need a lookup).
  const existingListIds = existingLists.map((l) => l.id);
  const existingEntryByKey = new Map<
    string,
    { id: string; unitPrice: string; validTo: string | null }
  >();

  if (existingListIds.length > 0) {
    const existingEntries = await prisma.priceListEntry.findMany({
      where: { priceListId: { in: existingListIds } },
      select: {
        id: true,
        priceListId: true,
        sapItemCodeSnapshot: true,
        unitPrice: true,
        validFrom: true,
        validTo: true,
      },
    });

    const listCodeById = new Map(existingLists.map((l) => [l.id, l.code]));

    for (const entry of existingEntries) {
      const code = listCodeById.get(entry.priceListId);
      if (!code) continue;

      const key = entryKey({
        priceListCode: code,
        itemCode: entry.sapItemCodeSnapshot,
        validFrom: entry.validFrom.toISOString().slice(0, 10),
      });

      existingEntryByKey.set(key, {
        id: entry.id,
        unitPrice: entry.unitPrice.toString(),
        validTo: entry.validTo ? entry.validTo.toISOString().slice(0, 10) : null,
      });
    }
  }

  const newEntries: NewEntry[] = [];
  const changedEntries: ChangedEntry[] = [];
  let unchangedEntryCount = 0;

  for (const row of rows) {
    const key: EntryKey = { priceListCode: row.priceListCode, itemCode: row.itemCode, validFrom: row.validFrom };
    const existing = existingEntryByKey.get(entryKey(key));

    if (!existing) {
      newEntries.push({ row });
      continue;
    }

    const hasChanges = existing.unitPrice !== row.unitPrice || existing.validTo !== row.validTo;

    if (hasChanges) {
      changedEntries.push({
        key,
        entryId: existing.id,
        current: { unitPrice: existing.unitPrice, validTo: existing.validTo },
        incoming: row,
      });
    } else {
      unchangedEntryCount += 1;
    }
  }

  return {
    newLists,
    changedLists,
    newEntries,
    changedEntries,
    unchangedEntryCount,
    unmatchedItemCodes,
  };
}

export interface PriceListImportResult {
  listsCreated: number;
  listsUpdated: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesUnchanged: number;
  auditEventId: string;
}

export async function executePriceListImport(
  plan: PriceListImportPlan,
  fileName: string
): Promise<PriceListImportResult> {
  const importId = randomUUID();

  // Lists must exist (created or confirmed) before entries can reference
  // them by id, and entry creation needs to know each list's id -- so
  // this runs as two sequential transactions rather than one, as a single
  // $transaction([...]) array can't use the id a prior operation in the
  // same array produced. Not fully atomic end-to-end, but each half is;
  // a failure between them leaves price lists created with zero entries
  // yet, which is a safe, visible, re-importable state, not a silent
  // partial write.
  await prisma.$transaction([
    ...plan.newLists.map((def) =>
      prisma.priceList.upsert({
        where: { code: def.code },
        create: { code: def.code, name: def.name, currencyCode: def.currencyCode },
        update: {},
      })
    ),
    ...plan.changedLists.map((change) =>
      prisma.priceList.update({
        where: { code: change.code },
        data: { name: change.incoming.name, currencyCode: change.incoming.currencyCode },
      })
    ),
  ]);

  const allListCodes = [
    ...new Set([
      ...plan.newLists.map((l) => l.code),
      ...plan.changedLists.map((l) => l.code),
      ...plan.newEntries.map((e) => e.row.priceListCode),
      ...plan.changedEntries.map((e) => e.key.priceListCode),
    ]),
  ];

  const lists = await prisma.priceList.findMany({
    where: { code: { in: allListCodes } },
    select: { id: true, code: true },
  });
  const listIdByCode = new Map(lists.map((l) => [l.code, l.id]));

  const itemCodes = [
    ...new Set([...plan.newEntries.map((e) => e.row.itemCode), ...plan.changedEntries.map((e) => e.incoming.itemCode)]),
  ];
  const products = await prisma.product.findMany({
    where: { sapItemCode: { in: itemCodes } },
    select: { id: true, sapItemCode: true },
  });
  const productIdByCode = new Map(products.map((p) => [p.sapItemCode, p.id]));

  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (const { row } of plan.newEntries) {
    const priceListId = listIdByCode.get(row.priceListCode);
    if (!priceListId) continue; // defensive; should be unreachable

    operations.push(
      prisma.priceListEntry.create({
        data: {
          priceListId,
          productId: productIdByCode.get(row.itemCode) ?? null,
          sapItemCodeSnapshot: row.itemCode,
          unitPrice: row.unitPrice,
          validFrom: dateOnlyStringToUtcDate(row.validFrom)!,
          validTo: dateOnlyStringToUtcDate(row.validTo),
        },
      })
    );
  }

  for (const change of plan.changedEntries) {
    operations.push(
      prisma.priceListEntry.update({
        where: { id: change.entryId },
        data: {
          unitPrice: change.incoming.unitPrice,
          validTo: dateOnlyStringToUtcDate(change.incoming.validTo),
        },
      })
    );
  }

  const recordedListChanges = plan.changedLists.slice(0, AUDIT_CHANGE_LIMIT);
  const recordedEntryChanges = plan.changedEntries.slice(0, AUDIT_CHANGE_LIMIT).map((c) => ({
    priceListCode: c.key.priceListCode,
    itemCode: c.key.itemCode,
    validFrom: c.key.validFrom,
    before: c.current,
    after: { unitPrice: c.incoming.unitPrice, validTo: c.incoming.validTo },
  }));

  operations.push(
    prisma.auditEvent.create({
      data: {
        actorId: null,
        action: "PRICE_LIST_IMPORT",
        entityType: "PriceListImport",
        entityId: importId,
        afterData: {
          fileName,
          listsCreated: plan.newLists.length,
          listsUpdated: plan.changedLists.length,
          listChanges: recordedListChanges,
          entriesCreated: plan.newEntries.length,
          entriesUpdated: plan.changedEntries.length,
          entriesUnchanged: plan.unchangedEntryCount,
          unmatchedItemCodes: plan.unmatchedItemCodes,
          entryChangesRecorded: recordedEntryChanges.length,
          entryChangesTruncated: plan.changedEntries.length > recordedEntryChanges.length,
          entryChanges: recordedEntryChanges,
        },
      },
    })
  );

  const audit = await prisma.$transaction(operations);
  const auditEvent = audit[audit.length - 1] as { id: string };

  return {
    listsCreated: plan.newLists.length,
    listsUpdated: plan.changedLists.length,
    entriesCreated: plan.newEntries.length,
    entriesUpdated: plan.changedEntries.length,
    entriesUnchanged: plan.unchangedEntryCount,
    auditEventId: auditEvent.id,
  };
}
