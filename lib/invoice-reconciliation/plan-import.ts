import "server-only";
import { prisma } from "@/lib/prisma";
import type { GroupedInvoiceHeader } from "@/lib/invoice-reconciliation/csv";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Stateless import planning --
 * no database writes, mirroring lib/customer-master-import.ts's own
 * planCustomerMasterImport: the file is re-parsed and re-planned at
 * confirm time, so the preview step (app/api/invoice-reconciliation/
 * import/preview) never writes anything either.
 *
 * Dedupe check (spec section 11's "do not rely solely on invoice numbers
 * if the SAP source provides a more reliable unique identifier"): a group
 * is a duplicate when its DocEntry (preferred) or DocNum (fallback)
 * already belongs to a SapInvoice row already in the database, OR
 * matches another group earlier in the SAME file -- groupIntoInvoices
 * already merges same-key rows into one group, so a within-file
 * duplicate can only arise from inconsistent DocEntry presence across
 * rows that should have been the same document; that edge case is
 * surfaced here rather than silently merged or silently imported twice.
 */

const LOOKUP_CHUNK_SIZE = 1000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// This milestone's importer accepts a SAP B1 CSV export, the same file
// type every other importer in this project accepts (customer-master,
// item-master, tax-codes, price-lists -- all CSV-only). Spec section 3
// says "Excel/CSV export only this milestone" (as opposed to a direct SAP
// API integration, which is Milestone 9); it does not require native
// .xlsx upload specifically, and none of this project's existing
// importers add that dependency. If the real SAP export is only ever
// produced as .xlsx in practice, the documented workaround is to save it
// as CSV first (Excel/SAP B1 both do this natively) -- adding native
// .xlsx parsing would be a small, isolated enhancement for a later round,
// not a reason to introduce a new dependency into an already-large
// milestone. Documented as a known limitation in PROGRESS.md.
export type InvoiceCsvUploadResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; status: number; message: string };

export async function readSapInvoiceCsvUpload(formData: FormData): Promise<InvoiceCsvUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, status: 400, message: "Please select an SAP invoice export CSV file." };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { ok: false, status: 400, message: "Only CSV files are supported. If your SAP export is an Excel file, save it as CSV first." };
  }
  if (file.size === 0) {
    return { ok: false, status: 400, message: "The selected CSV file is empty." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, status: 413, message: "The CSV file exceeds the 25 MB size limit." };
  }

  return { ok: true, fileName: file.name, csvText: await file.text() };
}

export interface DuplicateInvoiceGroup {
  group: GroupedInvoiceHeader;
  reason: string;
}

export interface PlannedInvoice {
  group: GroupedInvoiceHeader;
  matchedCustomerId: string | null;
}

export interface InvoiceImportPlan {
  newInvoices: PlannedInvoice[];
  duplicateInvoices: DuplicateInvoiceGroup[];
  invalidRowCount: number; // rows applyColumnMapping already rejected before grouping -- carried through for the summary, not recomputed here
  unmatchedCustomerCodes: string[]; // customer codes with no Customer.sapCustomerCode match -- not blocking; matchedCustomerId stays null for those invoices
}

export async function planSapInvoiceImport(
  groups: GroupedInvoiceHeader[],
  invalidRowCount: number
): Promise<InvoiceImportPlan> {
  // 1. Existing-invoice dedupe lookup, chunked exactly like
  // planCustomerMasterImport's own customer-code lookup.
  const docEntries = [...new Set(groups.map((g) => g.docEntry).filter((v): v is string => v !== null))];
  const docNums = [...new Set(groups.map((g) => g.docNum))];

  const existingByDocEntry = new Set<string>();
  const existingByDocNum = new Set<string>();

  for (let i = 0; i < docEntries.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = docEntries.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.sapInvoice.findMany({ where: { sapDocEntry: { in: chunk } }, select: { sapDocEntry: true } });
    for (const row of found) if (row.sapDocEntry) existingByDocEntry.add(row.sapDocEntry);
  }
  for (let i = 0; i < docNums.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = docNums.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.sapInvoice.findMany({ where: { sapDocNum: { in: chunk } }, select: { sapDocNum: true } });
    for (const row of found) existingByDocNum.add(row.sapDocNum);
  }

  // 2. Customer resolution lookup, same chunking.
  const customerCodes = [...new Set(groups.map((g) => g.customerCode).filter((v): v is string => v !== null))];
  const customerIdByCode = new Map<string, string>();
  for (let i = 0; i < customerCodes.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = customerCodes.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.customer.findMany({ where: { sapCustomerCode: { in: chunk } }, select: { id: true, sapCustomerCode: true } });
    for (const c of found) if (c.sapCustomerCode) customerIdByCode.set(c.sapCustomerCode, c.id);
  }

  const newInvoices: PlannedInvoice[] = [];
  const duplicateInvoices: DuplicateInvoiceGroup[] = [];
  const seenKeysThisFile = new Set<string>(); // within-file duplicate guard
  const unmatchedCustomerCodes = new Set<string>();

  for (const group of groups) {
    const existingDuplicate = group.docEntry ? existingByDocEntry.has(group.docEntry) : existingByDocNum.has(group.docNum);
    if (existingDuplicate) {
      duplicateInvoices.push({
        group,
        reason: group.docEntry
          ? `SAP invoice with DocEntry ${group.docEntry} has already been imported.`
          : `SAP invoice ${group.docNum} has already been imported.`,
      });
      continue;
    }

    if (seenKeysThisFile.has(group.groupKey)) {
      duplicateInvoices.push({ group, reason: `Invoice ${group.docNum} appears more than once in this file.` });
      continue;
    }
    seenKeysThisFile.add(group.groupKey);

    const matchedCustomerId = group.customerCode ? customerIdByCode.get(group.customerCode) ?? null : null;
    if (group.customerCode && matchedCustomerId === null) unmatchedCustomerCodes.add(group.customerCode);

    newInvoices.push({ group, matchedCustomerId });
  }

  return {
    newInvoices,
    duplicateInvoices,
    invalidRowCount,
    unmatchedCustomerCodes: [...unmatchedCustomerCodes],
  };
}
