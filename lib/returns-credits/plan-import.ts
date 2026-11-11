import "server-only";
import { prisma } from "@/lib/prisma";
import type { GroupedCreditNoteRow } from "@/lib/returns-credits/csv";

/**
 * Milestone 6B (Returns & Credit Notes). Stateless import planning -- no
 * database writes, mirroring lib/invoice-reconciliation/plan-import.ts's
 * own planSapInvoiceImport: the file is re-parsed and re-planned at
 * confirm time, so the preview step (app/api/returns-credits/import/
 * preview) never writes anything either.
 *
 * Dedupe check: a group is a duplicate when its DocEntry (preferred,
 * unique at the DB level -- CreditNote.sapCreditNoteDocEntry) or DocNum
 * (fallback, not unique at the DB level but still checked as a business
 * dedupe signal, same non-unique fallback lookup M5's own planSapInvoice
 * Import performs for sapDocNum) already belongs to a CreditNote row
 * already in the database, OR matches another group earlier in the SAME
 * file.
 *
 * Base-invoice resolution: every credit note's baseInvoiceDocEntry/
 * baseInvoiceDocNum is resolved against an already-imported SapInvoice
 * (Milestone 5) by exact identifier match only -- never guessed. A row
 * with no base-invoice reference at all, or one that doesn't resolve to
 * any imported SapInvoice, still imports with sapInvoiceId: null; it
 * simply cannot be auto-matched to a claim (lib/returns-credits/match-
 * credit-note.ts requires a resolved sapInvoiceId) and lands UNMATCHED
 * for manual reconciliation, same philosophy as Milestone 5's own
 * unmatched queue.
 */

const LOOKUP_CHUNK_SIZE = 1000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export type CreditNoteCsvUploadResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; status: number; message: string };

export async function readCreditNoteCsvUpload(formData: FormData): Promise<CreditNoteCsvUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, status: 400, message: "Please select an SAP credit note export CSV file." };
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

export interface DuplicateCreditNoteGroup {
  group: GroupedCreditNoteRow;
  reason: string;
}

export interface PlannedCreditNote {
  group: GroupedCreditNoteRow;
  /** Resolved from baseInvoiceDocEntry/baseInvoiceDocNum against an
   * already-imported SapInvoice -- never guessed; null when no exact
   * match was found (the row still imports, just unable to auto-match). */
  resolvedSapInvoiceId: string | null;
}

export interface CreditNoteImportPlan {
  newCreditNotes: PlannedCreditNote[];
  duplicateCreditNotes: DuplicateCreditNoteGroup[];
  invalidRowCount: number; // rows applyCreditNoteColumnMapping already rejected before grouping -- carried through for the summary, not recomputed here
  unresolvedBaseInvoiceReferences: string[]; // base-invoice identifiers that didn't match any imported SapInvoice -- not blocking
}

export async function planCreditNoteImport(
  groups: GroupedCreditNoteRow[],
  invalidRowCount: number
): Promise<CreditNoteImportPlan> {
  // 1. Existing-credit-note dedupe lookup, chunked exactly like
  // planSapInvoiceImport's own lookup.
  const docEntries = [...new Set(groups.map((g) => g.docEntry).filter((v): v is string => v !== null))];
  const docNums = [...new Set(groups.map((g) => g.docNum))];

  const existingByDocEntry = new Set<string>();
  const existingByDocNum = new Set<string>();

  for (let i = 0; i < docEntries.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = docEntries.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.creditNote.findMany({ where: { sapCreditNoteDocEntry: { in: chunk } }, select: { sapCreditNoteDocEntry: true } });
    for (const row of found) if (row.sapCreditNoteDocEntry) existingByDocEntry.add(row.sapCreditNoteDocEntry);
  }
  for (let i = 0; i < docNums.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = docNums.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.creditNote.findMany({ where: { sapCreditNoteDocNum: { in: chunk } }, select: { sapCreditNoteDocNum: true } });
    for (const row of found) existingByDocNum.add(row.sapCreditNoteDocNum);
  }

  // 2. Base-invoice resolution lookup, same chunking and same DocEntry-
  // preferred-else-DocNum precedence as the dedupe check above.
  const baseDocEntries = [...new Set(groups.map((g) => g.baseInvoiceDocEntry).filter((v): v is string => v !== null))];
  const baseDocNums = [...new Set(groups.map((g) => g.baseInvoiceDocNum).filter((v): v is string => v !== null))];

  const invoiceIdByDocEntry = new Map<string, string>();
  const invoiceIdByDocNum = new Map<string, string>();

  for (let i = 0; i < baseDocEntries.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = baseDocEntries.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.sapInvoice.findMany({ where: { sapDocEntry: { in: chunk } }, select: { id: true, sapDocEntry: true } });
    for (const row of found) if (row.sapDocEntry) invoiceIdByDocEntry.set(row.sapDocEntry, row.id);
  }
  for (let i = 0; i < baseDocNums.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = baseDocNums.slice(i, i + LOOKUP_CHUNK_SIZE);
    const found = await prisma.sapInvoice.findMany({ where: { sapDocNum: { in: chunk } }, select: { id: true, sapDocNum: true } });
    for (const row of found) invoiceIdByDocNum.set(row.sapDocNum, row.id);
  }

  const newCreditNotes: PlannedCreditNote[] = [];
  const duplicateCreditNotes: DuplicateCreditNoteGroup[] = [];
  const seenKeysThisFile = new Set<string>(); // within-file duplicate guard
  const unresolvedBaseInvoiceReferences = new Set<string>();

  for (const group of groups) {
    const existingDuplicate = group.docEntry ? existingByDocEntry.has(group.docEntry) : existingByDocNum.has(group.docNum);
    if (existingDuplicate) {
      duplicateCreditNotes.push({
        group,
        reason: group.docEntry
          ? `Credit note with DocEntry ${group.docEntry} has already been imported.`
          : `Credit note ${group.docNum} has already been imported.`,
      });
      continue;
    }

    if (seenKeysThisFile.has(group.groupKey)) {
      duplicateCreditNotes.push({ group, reason: `Credit note ${group.docNum} appears more than once in this file.` });
      continue;
    }
    seenKeysThisFile.add(group.groupKey);

    let resolvedSapInvoiceId: string | null = null;
    if (group.baseInvoiceDocEntry && invoiceIdByDocEntry.has(group.baseInvoiceDocEntry)) {
      resolvedSapInvoiceId = invoiceIdByDocEntry.get(group.baseInvoiceDocEntry) ?? null;
    } else if (group.baseInvoiceDocNum && invoiceIdByDocNum.has(group.baseInvoiceDocNum)) {
      resolvedSapInvoiceId = invoiceIdByDocNum.get(group.baseInvoiceDocNum) ?? null;
    }

    if (resolvedSapInvoiceId === null && (group.baseInvoiceDocEntry || group.baseInvoiceDocNum)) {
      unresolvedBaseInvoiceReferences.add(group.baseInvoiceDocEntry ?? group.baseInvoiceDocNum!);
    }

    newCreditNotes.push({ group, resolvedSapInvoiceId });
  }

  return {
    newCreditNotes,
    duplicateCreditNotes,
    invalidRowCount,
    unresolvedBaseInvoiceReferences: [...unresolvedBaseInvoiceReferences],
  };
}
