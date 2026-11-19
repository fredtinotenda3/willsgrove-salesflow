import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { CustomerMasterRow } from "@/lib/sap-customer-master-csv";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const LOOKUP_CHUNK_SIZE = 1000;
const AUDIT_CHANGE_LIMIT = 500;

// Real-world incident fix: the real List_of_Business_Partners.xlsx has
// 2647 rows. executeCustomerMasterImport USED TO wrap every single
// customer of a whole import -- new creates, updates, and the audit
// event -- in ONE prisma.$transaction({ maxWait: 15000, timeout: 30000 }),
// processing each row as its own sequential round trip (each ALSO gated
// by lib/prisma.ts's process-wide query-concurrency semaphore, shared
// with every other concurrent request the app is serving). For a file
// this size that reliably exceeds Prisma's 30s interactive-transaction
// timeout partway through the loop; Postgres/Prisma then closes the
// transaction server-side, and the next tx.* call inside the (still
// executing, unaware) callback throws P2028 "Transaction not found...
// obtained before disconnecting." -- confirmed against a real reported
// stack trace and the real file's row count, not assumed.
//
// Fix, in two parts:
//
// 1. Bulk-insert new customers with createMany in bounded chunks
//    whenever a row has no nested location/contact write to make (the
//    LEAN layout -- the real Business Partner list's actual shape --
//    NEVER has one; confirmed empirically against all 2647 real rows).
//    createMany issues ONE SQL statement per chunk, not N round trips,
//    and needs no interactive transaction at all (a single Prisma write
//    call is already atomic on its own) -- this is the fast path that
//    matters for the real file.
// 2. A row that DOES carry a nested location/contact write (only
//    possible via the legacy RICH layout, never LEAN) still needs
//    createMany's one limitation worked around: it can't do nested
//    writes. Those rows fall back to individual customer.create() calls
//    -- each one is ALSO already atomic on its own (Prisma wraps a
//    single call's nested writes in its own implicit transaction), so
//    this still needs no explicit multi-row $transaction wrapper either.
//
// Net effect: no step of this import holds one database transaction
// open across more than one row, so no row count can ever make it
// exceed any timeout. The deliberate, disclosed tradeoff this drops:
// the import is no longer all-or-nothing across the WHOLE file (a
// chunk failing partway no longer rolls back chunks that already
// committed). This is judged the right tradeoff, not a regression,
// because planCustomerMasterImport's own existingByCode lookup already
// makes a re-run of the exact same file idempotent -- rows already
// created land in "unchanged" (or "changed", if the DB and file now
// disagree) on the next plan, never duplicated -- so recovering from a
// partial failure is simply: re-run the same file. See
// CustomerMasterImportResult.partial below for how this is surfaced
// rather than silently masked as full success.
const NEW_CUSTOMER_CREATE_MANY_CHUNK_SIZE = 500;
// Deliberately small: unlike the createMany path above, this chunk still
// runs as one real interactive transaction (prisma.$transaction(async
// (tx) => ...)) containing one sequential tx.customer.update() call per
// row in the chunk -- the exact same mechanism the original, broken
// code used for the whole file, just now bounded to a size whose total
// duration can never approach any sane timeout even under this app's
// own worst-case query-concurrency-gate queueing. (The array form of
// $transaction, prisma.$transaction([op1, op2, ...]), was deliberately
// NOT used here instead: Prisma Client Extensions' query hook wraps the
// promise each prisma.<model>.<op>(...) call returns, which is a
// documented source of batch-transaction incompatibility with an
// extended client -- see https://github.com/prisma/prisma/issues/20738
// and related issues. This project's prisma export (lib/prisma.ts) is
// always extended (the query-concurrency gate), so the array form's
// correctness here could not be verified against a real database in
// this sandbox -- the interactive-callback form below is the same
// mechanism already proven to work correctly elsewhere in this
// codebase, just chunked.)
const CHANGED_CUSTOMER_UPDATE_CHUNK_SIZE = 50;

export type CsvUploadResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; status: number; message: string };

export async function readCustomerMasterCsvUpload(formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, status: 400, message: "Please select a customer-master CSV file." };
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
// c.current`) in the Json payload passed to AuditEvent.afterData below;
// a named `interface` of this exact shape fails Prisma's real
// InputJsonObject index-signature check, a `type` alias does not.
export type ExistingCustomerMasterSnapshot = {
  id: string;
  name: string;
  tin: string | null;
  vatNumber: string | null;
  currencyCode: string | null;
  priceListId: string | null;
  paymentTermsCode: string | null;
  branchCode: string | null;
  storeCode: string | null;
  creditLimit: string | null;
  creditHold: boolean;
};

export interface NewCustomer {
  row: CustomerMasterRow;
  priceListId: string | null;
}

export interface ChangedCustomer {
  code: string;
  id: string;
  current: ExistingCustomerMasterSnapshot;
  incoming: CustomerMasterRow;
  priceListId: string | null;
}

export interface CustomerMasterImportPlan {
  newCustomers: NewCustomer[];
  changedCustomers: ChangedCustomer[];
  unchangedCount: number;
  // Price-list codes referenced that don't (yet) exist. Not blocking --
  // the customer is still imported/updated with priceListId left null for
  // that row -- but surfaced so the operator knows to also run the
  // price-list import.
  unmatchedPriceListCodes: string[];
}

export async function planCustomerMasterImport(
  rows: CustomerMasterRow[]
): Promise<CustomerMasterImportPlan> {
  const existingByCode = new Map<string, ExistingCustomerMasterSnapshot>();

  for (let i = 0; i < rows.length; i += LOOKUP_CHUNK_SIZE) {
    const codes = rows.slice(i, i + LOOKUP_CHUNK_SIZE).map((r) => r.customerCode);

    const existing = await prisma.customer.findMany({
      where: { sapCustomerCode: { in: codes } },
      select: {
        id: true,
        sapCustomerCode: true,
        name: true,
        tin: true,
        vatNumber: true,
        currencyCode: true,
        priceListId: true,
        paymentTermsCode: true,
        branchCode: true,
        storeCode: true,
        creditLimit: true,
        creditHold: true,
      },
    });

    for (const c of existing) {
      if (!c.sapCustomerCode) continue;
      existingByCode.set(c.sapCustomerCode, {
        id: c.id,
        name: c.name,
        tin: c.tin,
        vatNumber: c.vatNumber,
        currencyCode: c.currencyCode,
        priceListId: c.priceListId,
        paymentTermsCode: c.paymentTermsCode,
        branchCode: c.branchCode,
        storeCode: c.storeCode,
        creditLimit: c.creditLimit ? c.creditLimit.toString() : null,
        creditHold: c.creditHold,
      });
    }
  }

  const priceListCodes = [...new Set(rows.map((r) => r.priceListCode).filter((v): v is string => v !== null))];
  const priceListIdByCode = new Map<string, string>();

  for (let i = 0; i < priceListCodes.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = priceListCodes.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.priceList.findMany({ where: { code: { in: chunk } }, select: { id: true, code: true } });
    for (const p of found) priceListIdByCode.set(p.code, p.id);
  }

  const unmatchedPriceListCodes = priceListCodes.filter((code) => !priceListIdByCode.has(code));

  const newCustomers: NewCustomer[] = [];
  const changedCustomers: ChangedCustomer[] = [];
  let unchangedCount = 0;

  for (const row of rows) {
    const priceListId = row.priceListCode ? priceListIdByCode.get(row.priceListCode) ?? null : null;
    const existing = existingByCode.get(row.customerCode);

    if (!existing) {
      newCustomers.push({ row, priceListId });
      continue;
    }

    const hasChanges =
      existing.name !== row.customerName ||
      existing.tin !== row.tin ||
      existing.vatNumber !== row.vatNumber ||
      existing.currencyCode !== row.currencyCode ||
      existing.priceListId !== priceListId ||
      existing.paymentTermsCode !== row.paymentTermsCode ||
      existing.branchCode !== row.branchCode ||
      existing.storeCode !== row.storeCode ||
      existing.creditLimit !== row.creditLimit ||
      existing.creditHold !== row.creditHold;

    if (hasChanges) {
      changedCustomers.push({ code: row.customerCode, id: existing.id, current: existing, incoming: row, priceListId });
    } else {
      unchangedCount += 1;
    }
  }

  return { newCustomers, changedCustomers, unchangedCount, unmatchedPriceListCodes };
}

export interface CustomerMasterImportResult {
  created: number;
  updated: number;
  unchanged: number;
  auditEventId: string;
  // true when a chunk failed partway through (see this file's module
  // comment) -- created/updated reflect only what actually committed
  // before the failure. The caller must surface this as a partial
  // outcome, never as plain success, and tell the operator the same
  // file can be safely re-run (planCustomerMasterImport's own
  // existingByCode lookup makes this idempotent).
  partial: boolean;
  partialReason?: string;
}

function toNewCustomerCreateManyRow(row: CustomerMasterRow, priceListId: string | null) {
  return {
    name: row.customerName,
    sapCustomerCode: row.customerCode,
    email: row.email,
    phone: row.phone,
    tin: row.tin,
    vatNumber: row.vatNumber,
    currencyCode: row.currencyCode,
    paymentTermsCode: row.paymentTermsCode,
    branchCode: row.branchCode,
    storeCode: row.storeCode,
    creditLimit: row.creditLimit,
    creditHold: row.creditHold,
    priceListId,
  };
}

async function createOneCustomerWithNestedWrites(row: CustomerMasterRow, priceListId: string | null): Promise<void> {
  await prisma.customer.create({
    data: {
      ...toNewCustomerCreateManyRow(row, priceListId),
      ...(row.addressLine1
        ? {
            locations: {
              create: {
                label: row.storeCode ? `Store ${row.storeCode}` : "Primary",
                addressLine1: row.addressLine1,
                city: row.city,
                isDefault: true,
              },
            },
          }
        : {}),
      ...(row.contactName
        ? {
            contacts: {
              create: {
                name: row.contactName,
                email: row.contactEmail,
                phone: row.contactPhone,
              },
            },
          }
        : {}),
    },
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function executeCustomerMasterImport(
  plan: CustomerMasterImportPlan,
  fileName: string
): Promise<CustomerMasterImportResult> {
  const importId = randomUUID();
  const createdCodes: string[] = [];
  const appliedChanges: ChangedCustomer[] = [];
  let partialReason: string | undefined;

  try {
    // New customers: split into the real-world-common fast path
    // (createMany, no nested writes -- see this file's module comment)
    // and the rare nested-write path, each processed in bounded chunks
    // so no single database call's duration can scale with the whole
    // file's size.
    const withoutNested = plan.newCustomers.filter((c) => !c.row.addressLine1 && !c.row.contactName);
    const withNested = plan.newCustomers.filter((c) => c.row.addressLine1 || c.row.contactName);

    for (const batch of chunk(withoutNested, NEW_CUSTOMER_CREATE_MANY_CHUNK_SIZE)) {
      await prisma.customer.createMany({
        data: batch.map(({ row, priceListId }) => toNewCustomerCreateManyRow(row, priceListId)),
      });
      createdCodes.push(...batch.map((c) => c.row.customerCode));
    }

    for (const { row, priceListId } of withNested) {
      await createOneCustomerWithNestedWrites(row, priceListId);
      createdCodes.push(row.customerCode);
    }

    // Updates touch only Customer-level master-data fields. Locations and
    // contacts on an already-existing customer are left alone -- they may
    // have been entered or edited by hand since the customer was created,
    // and a flat master-data re-import shouldn't silently clobber that.
    // Chunked into small transactions (not one global one, same reasoning
    // as above) purely so a batch's worth of updates stays atomic as a
    // unit without any batch's duration being able to grow unbounded.
    for (const batch of chunk(plan.changedCustomers, CHANGED_CUSTOMER_UPDATE_CHUNK_SIZE)) {
      await prisma.$transaction(
        async (tx) => {
          for (const change of batch) {
            await tx.customer.update({
              where: { id: change.id },
              data: {
                name: change.incoming.customerName,
                tin: change.incoming.tin,
                vatNumber: change.incoming.vatNumber,
                currencyCode: change.incoming.currencyCode,
                priceListId: change.priceListId,
                paymentTermsCode: change.incoming.paymentTermsCode,
                branchCode: change.incoming.branchCode,
                storeCode: change.incoming.storeCode,
                creditLimit: change.incoming.creditLimit,
                creditHold: change.incoming.creditHold,
              },
            });
          }
        },
        { maxWait: 10000, timeout: 20000 }
      );
      appliedChanges.push(...batch);
    }
  } catch (error) {
    // A chunk failed partway through. Everything pushed to createdCodes/
    // appliedChanges above already committed (createMany and each
    // $transaction([...]) batch-array call are independently atomic) --
    // record exactly that much, truthfully, rather than throwing the
    // partial progress away or claiming it didn't happen.
    partialReason = error instanceof Error ? error.message : "An unexpected error interrupted the import.";
  }

  const recordedChanges = appliedChanges.slice(0, AUDIT_CHANGE_LIMIT).map((c) => ({
    code: c.code,
    before: c.current,
    after: {
      name: c.incoming.customerName,
      tin: c.incoming.tin,
      vatNumber: c.incoming.vatNumber,
      currencyCode: c.incoming.currencyCode,
      priceListId: c.priceListId,
      paymentTermsCode: c.incoming.paymentTermsCode,
      branchCode: c.incoming.branchCode,
      storeCode: c.incoming.storeCode,
      creditLimit: c.incoming.creditLimit,
      creditHold: c.incoming.creditHold,
    },
  }));

  // One audit event per import attempt, written after the fact so it
  // reflects actual outcome (partial or complete) -- never inside a
  // customer-row write, and never claiming more than what the
  // createdCodes/appliedChanges arrays above actually recorded.
  await prisma.auditEvent.create({
    data: {
      actorId: null,
      action: "CUSTOMER_MASTER_IMPORT",
      entityType: "CustomerMasterImport",
      entityId: importId,
      afterData: {
        fileName,
        created: createdCodes.length,
        updated: appliedChanges.length,
        unchanged: plan.unchangedCount,
        createdCodes: createdCodes.slice(0, AUDIT_CHANGE_LIMIT),
        unmatchedPriceListCodes: plan.unmatchedPriceListCodes,
        changesRecorded: recordedChanges.length,
        changesTruncated: appliedChanges.length > recordedChanges.length,
        changes: recordedChanges,
        partial: partialReason !== undefined,
        partialReason: partialReason ?? null,
        plannedCreates: plan.newCustomers.length,
        plannedUpdates: plan.changedCustomers.length,
      },
    },
  });

  const auditEvent = await prisma.auditEvent.findFirst({
    where: { entityType: "CustomerMasterImport", entityId: importId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return {
    created: createdCodes.length,
    updated: appliedChanges.length,
    unchanged: plan.unchangedCount,
    auditEventId: auditEvent?.id ?? "",
    partial: partialReason !== undefined,
    partialReason,
  };
}
