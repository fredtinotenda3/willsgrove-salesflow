import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { CustomerMasterRow } from "@/lib/sap-customer-master-csv";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const LOOKUP_CHUNK_SIZE = 1000;
const AUDIT_CHANGE_LIMIT = 500;

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
}

export async function executeCustomerMasterImport(
  plan: CustomerMasterImportPlan,
  fileName: string
): Promise<CustomerMasterImportResult> {
  const importId = randomUUID();

  const createdCodes = await prisma.$transaction(async (tx) => {
    const created: string[] = [];

    // Sequential, not Promise.all: each create can include nested
    // location/contact writes, and (as scripts/remove-demo-data.ts's own
    // comments explain) concurrent queries against one interactive-
    // transaction client aren't safe in Prisma. Import files are run
    // rarely, outside any request-latency budget, so sequential is the
    // right tradeoff here, same as that script's.
    for (const { row, priceListId } of plan.newCustomers) {
      await tx.customer.create({
        data: {
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

      created.push(row.customerCode);
    }

    // Updates touch only Customer-level master-data fields. Locations and
    // contacts on an already-existing customer are left alone -- they may
    // have been entered or edited by hand since the customer was created,
    // and a flat master-data re-import shouldn't silently clobber that.
    for (const change of plan.changedCustomers) {
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

    const recordedChanges = plan.changedCustomers.slice(0, AUDIT_CHANGE_LIMIT).map((c) => ({
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

    await tx.auditEvent.create({
      data: {
        actorId: null,
        action: "CUSTOMER_MASTER_IMPORT",
        entityType: "CustomerMasterImport",
        entityId: importId,
        afterData: {
          fileName,
          created: plan.newCustomers.length,
          updated: plan.changedCustomers.length,
          unchanged: plan.unchangedCount,
          createdCodes: created.slice(0, AUDIT_CHANGE_LIMIT),
          unmatchedPriceListCodes: plan.unmatchedPriceListCodes,
          changesRecorded: recordedChanges.length,
          changesTruncated: plan.changedCustomers.length > recordedChanges.length,
          changes: recordedChanges,
        },
      },
    });

    return created;
  }, { maxWait: 15000, timeout: 30000 });

  const auditEvent = await prisma.auditEvent.findFirst({
    where: { entityType: "CustomerMasterImport", entityId: importId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return {
    created: createdCodes.length,
    updated: plan.changedCustomers.length,
    unchanged: plan.unchangedCount,
    auditEventId: auditEvent?.id ?? "",
  };
}
