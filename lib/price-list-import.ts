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

// Real Business Data Onboarding round (spec PART A, Phase 4a): the real
// SAP price-list export the business has (business-data/Prices.xlsx) is
// a 7-sheet .xlsx workbook, not the invented flat CSV shape
// lib/sap-price-list-csv.ts was built around (see lib/sap-price-list-xlsx.ts's
// module comment for why that's read directly rather than hand-converted
// first). This widens the upload accepted by both price-list import API
// routes to either format -- readPriceListCsvUpload above is UNCHANGED
// and still used wherever a .csv is actually uploaded; this is an
// additional, format-detecting entry point, not a replacement.
export type PriceListFileUploadResult =
  | { ok: true; fileName: string; kind: "csv"; csvText: string }
  | { ok: true; fileName: string; kind: "xlsx"; buffer: Buffer }
  | { ok: false; status: number; message: string };

export async function readPriceListFileUpload(formData: FormData): Promise<PriceListFileUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, status: 400, message: "Please select a price-list CSV or Excel (.xlsx) file." };
  }
  if (file.size === 0) {
    return { ok: false, status: 400, message: "The selected file is empty." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, status: 413, message: "The file exceeds the 25 MB size limit." };
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return { ok: true, fileName: file.name, kind: "csv", csvText: await file.text() };
  }
  if (lowerName.endsWith(".xlsx")) {
    const arrayBuffer = await file.arrayBuffer();
    return { ok: true, fileName: file.name, kind: "xlsx", buffer: Buffer.from(arrayBuffer) };
  }
  return { ok: false, status: 400, message: "Only .csv or .xlsx files are supported." };
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

    // Real Business Data Onboarding round (spec PART A, Phase 4): a plain
    // string comparison here is wrong, and was never exercised against a
    // real database before this round's DB-integration test caught it
    // (tests/price-list-customer-pricing-db.integration.test.ts) --
    // existing.unitPrice comes from a Prisma Decimal(18,4) column's own
    // .toString(), which strips trailing zeros ("0.7000" -> "0.7"), while
    // an incoming row's unitPrice is whatever string its source parser
    // captured verbatim (lib/sap-price-list-xlsx.ts keeps "USD 0.70"'s
    // "0.70" exactly; lib/sap-price-list-csv.ts's UNIT_PRICE column can
    // equally carry a trailing zero). "0.70" !== "0.7" as plain strings
    // even though they're the same price, which would have marked every
    // such entry "changed" on every single re-import forever -- re-import
    // idempotency (this file's own docs/milestones claim, and the Price
    // Lists Import page's explicit "nothing has been saved yet" preview
    // promise) depends on this comparison being numeric, not textual.
    // Prisma.Decimal is this codebase's own established pattern for exact
    // decimal comparison (lib/quotations/calculations.ts and others).
    const hasChanges = !new Prisma.Decimal(existing.unitPrice).equals(new Prisma.Decimal(row.unitPrice)) || existing.validTo !== row.validTo;

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
  partial: boolean;
  partialReason?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Real-world incident fix, same diagnosis and same fix shape as
// lib/customer-master-import.ts's own module comment documents for that
// file's identical prior bug: the real business-data/Prices.xlsx workbook
// has thousands of entry rows across its 7 sheets. This function used to
// push ONE Prisma operation per new/changed entry into a single flat
// array and run it as one prisma.$transaction(operations) batch-array
// call. Two compounding problems, either one enough on its own to make
// "Confirm and import" never complete for a file this size:
//   1. The array form of $transaction defaults to a 5s `timeout`/2s
//      `maxWait` with no override here, and a transaction holding
//      thousands of sequential round trips open reliably exceeds that.
//   2. lib/prisma.ts's exported client is always extended (the
//      query-concurrency gate), and the array form of $transaction is a
//      documented source of batch-transaction incompatibility with an
//      extended client (see
//      https://github.com/prisma/prisma/issues/20738) -- independent of
//      size or timeout.
// Fixed the same way lib/customer-master-import.ts already fixed the
// identical bug for its own large-file case: new entries are bulk-
// inserted with createMany in bounded chunks (one SQL statement per
// chunk, no transaction wrapper needed -- already atomic on its own, and
// never the array form), and changed entries are chunked into small
// interactive (callback-form, never array-form) transactions. No single
// database call's duration can scale with the whole file's size any
// more. The lists step above stays a single interactive transaction too
// (never the array form) -- it is bounded by the distinct price-list
// codes in one file (typically a handful), nowhere near any timeout, but
// correctness under the extended client is the same concern regardless
// of size.
const NEW_ENTRY_CREATE_MANY_CHUNK_SIZE = 500;
const CHANGED_ENTRY_UPDATE_CHUNK_SIZE = 50;

export async function executePriceListImport(
  plan: PriceListImportPlan,
  fileName: string
): Promise<PriceListImportResult> {
  const importId = randomUUID();

  // Lists must exist (created or confirmed) before entries can reference
  // them by id, and entry creation needs to know each list's id -- so
  // this runs as two sequential steps rather than one. Not fully atomic
  // end-to-end, but each half is; a failure between them leaves price
  // lists created with zero entries yet, which is a safe, visible,
  // re-importable state, not a silent partial write.
  await prisma.$transaction(
    async (tx) => {
      for (const def of plan.newLists) {
        await tx.priceList.upsert({
          where: { code: def.code },
          create: { code: def.code, name: def.name, currencyCode: def.currencyCode },
          update: {},
        });
      }
      for (const change of plan.changedLists) {
        await tx.priceList.update({
          where: { code: change.code },
          data: { name: change.incoming.name, currencyCode: change.incoming.currencyCode },
        });
      }
    },
    { maxWait: 10000, timeout: 20000 }
  );

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

  let entriesCreated = 0;
  let entriesUpdated = 0;
  const appliedEntryChanges: ChangedEntry[] = [];
  let partialReason: string | undefined;

  try {
    // New entries: createMany in bounded chunks -- one SQL statement per
    // chunk, no transaction wrapper needed (createMany is already atomic
    // on its own, and this never uses the array form of $transaction).
    for (const batch of chunk(plan.newEntries, NEW_ENTRY_CREATE_MANY_CHUNK_SIZE)) {
      const data = batch
        .map(({ row }) => {
          const priceListId = listIdByCode.get(row.priceListCode);
          if (!priceListId) return null; // defensive; should be unreachable
          return {
            priceListId,
            productId: productIdByCode.get(row.itemCode) ?? null,
            sapItemCodeSnapshot: row.itemCode,
            unitPrice: row.unitPrice,
            validFrom: dateOnlyStringToUtcDate(row.validFrom)!,
            validTo: dateOnlyStringToUtcDate(row.validTo),
          };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null);

      if (data.length > 0) {
        await prisma.priceListEntry.createMany({ data });
        entriesCreated += data.length;
      }
    }

    // Changed entries: chunked into small interactive transactions (never
    // the array form), same reasoning and chunk size as
    // lib/customer-master-import.ts's own changed-row path.
    for (const batch of chunk(plan.changedEntries, CHANGED_ENTRY_UPDATE_CHUNK_SIZE)) {
      await prisma.$transaction(
        async (tx) => {
          for (const change of batch) {
            await tx.priceListEntry.update({
              where: { id: change.entryId },
              data: {
                unitPrice: change.incoming.unitPrice,
                validTo: dateOnlyStringToUtcDate(change.incoming.validTo),
              },
            });
          }
        },
        { maxWait: 10000, timeout: 20000 }
      );
      appliedEntryChanges.push(...batch);
      entriesUpdated += batch.length;
    }
  } catch (error) {
    // A chunk failed partway through. Everything counted in
    // entriesCreated/appliedEntryChanges above already committed
    // (createMany and each interactive-transaction batch are
    // independently atomic) -- record exactly that much, truthfully,
    // rather than throwing the partial progress away or claiming it
    // didn't happen. Same recovery story as
    // lib/customer-master-import.ts's identical case: re-running the
    // exact same file is safe (already-imported rows are detected as
    // unchanged on the next plan, never duplicated).
    partialReason = error instanceof Error ? error.message : "An unexpected error interrupted the import.";
  }

  const recordedListChanges = plan.changedLists.slice(0, AUDIT_CHANGE_LIMIT);
  const recordedEntryChanges = appliedEntryChanges.slice(0, AUDIT_CHANGE_LIMIT).map((c) => ({
    priceListCode: c.key.priceListCode,
    itemCode: c.key.itemCode,
    validFrom: c.key.validFrom,
    before: c.current,
    after: { unitPrice: c.incoming.unitPrice, validTo: c.incoming.validTo },
  }));

  // One audit event per import attempt, written after the fact so it
  // reflects actual outcome (partial or complete) -- never inside the
  // entry-writing loop above, and never claiming more than
  // entriesCreated/entriesUpdated actually recorded.
  await prisma.auditEvent.create({
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
        entriesCreated,
        entriesUpdated,
        entriesUnchanged: plan.unchangedEntryCount,
        unmatchedItemCodes: plan.unmatchedItemCodes,
        entryChangesRecorded: recordedEntryChanges.length,
        entryChangesTruncated: appliedEntryChanges.length > recordedEntryChanges.length,
        entryChanges: recordedEntryChanges,
        partial: partialReason !== undefined,
        partialReason: partialReason ?? null,
        plannedEntriesCreated: plan.newEntries.length,
        plannedEntriesUpdated: plan.changedEntries.length,
      },
    },
  });

  const auditEvent = await prisma.auditEvent.findFirst({
    where: { entityType: "PriceListImport", entityId: importId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return {
    listsCreated: plan.newLists.length,
    listsUpdated: plan.changedLists.length,
    entriesCreated,
    entriesUpdated,
    entriesUnchanged: plan.unchangedEntryCount,
    auditEventId: auditEvent?.id ?? "",
    partial: partialReason !== undefined,
    partialReason,
  };
}
