import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaxCodeRow } from "@/lib/sap-tax-code-csv";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const LOOKUP_CHUNK_SIZE = 1000;
const AUDIT_CHANGE_LIMIT = 500;

export type CsvUploadResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; status: number; message: string };

export async function readTaxCodeCsvUpload(
  formData: FormData
): Promise<CsvUploadResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, status: 400, message: "Please select a tax-code CSV file." };
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { ok: false, status: 400, message: "Only CSV files are supported." };
  }

  if (file.size === 0) {
    return { ok: false, status: 400, message: "The selected CSV file is empty." };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, status: 413, message: "The CSV file exceeds the 5 MB size limit." };
  }

  return { ok: true, fileName: file.name, csvText: await file.text() };
}

// Declared as a `type` alias, not an `interface`, on purpose: this value
// is embedded as-is (via `before: change.current`) inside the Json
// payload passed to AuditEvent.afterData below. Prisma's real generated
// client requires NullableJsonNullValueInput | Prisma.InputJsonValue for
// that field, and Prisma.InputJsonObject carries a string index
// signature that a named `interface` does not structurally satisfy even
// when every property it declares is already JSON-safe -- a `type`
// alias for the identical shape does satisfy it. Confirmed against the
// real (non-stub) Prisma runtime types, not assumed: this sandbox's
// stub client accepts anything here regardless, so this specific class
// of error is invisible until compiled against a real generated client.
export type ExistingTaxCodeSnapshot = {
  code: string;
  description: string | null;
  ratePercent: string;
};

export interface ChangedTaxCode {
  code: string;
  current: ExistingTaxCodeSnapshot;
  incoming: TaxCodeRow;
}

export interface TaxCodeImportPlan {
  newCodes: TaxCodeRow[];
  changedCodes: ChangedTaxCode[];
  unchangedCodes: TaxCodeRow[];
}

export async function planTaxCodeImport(
  rows: TaxCodeRow[]
): Promise<TaxCodeImportPlan> {
  const existingByCode = new Map<string, ExistingTaxCodeSnapshot>();

  for (let i = 0; i < rows.length; i += LOOKUP_CHUNK_SIZE) {
    const codes = rows.slice(i, i + LOOKUP_CHUNK_SIZE).map((r) => r.code);

    const existing = await prisma.taxCode.findMany({
      where: { code: { in: codes } },
      select: { code: true, description: true, ratePercent: true },
    });

    for (const row of existing) {
      existingByCode.set(row.code, {
        code: row.code,
        description: row.description,
        ratePercent: row.ratePercent.toString(),
      });
    }
  }

  const newCodes: TaxCodeRow[] = [];
  const changedCodes: ChangedTaxCode[] = [];
  const unchangedCodes: TaxCodeRow[] = [];

  for (const row of rows) {
    const existing = existingByCode.get(row.code);

    if (!existing) {
      newCodes.push(row);
      continue;
    }

    const hasChanges =
      existing.description !== row.description ||
      existing.ratePercent !== row.ratePercent;

    if (hasChanges) {
      changedCodes.push({ code: row.code, current: existing, incoming: row });
    } else {
      unchangedCodes.push(row);
    }
  }

  return { newCodes, changedCodes, unchangedCodes };
}

export interface TaxCodeImportResult {
  created: number;
  updated: number;
  unchanged: number;
  auditEventId: string;
}

export async function executeTaxCodeImport(
  plan: TaxCodeImportPlan,
  fileName: string
): Promise<TaxCodeImportResult> {
  const importId = randomUUID();
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  if (plan.newCodes.length > 0) {
    operations.push(
      prisma.taxCode.createMany({
        data: plan.newCodes.map((row) => ({
          code: row.code,
          description: row.description,
          ratePercent: row.ratePercent,
        })),
        skipDuplicates: true,
      })
    );
  }

  for (const change of plan.changedCodes) {
    operations.push(
      prisma.taxCode.update({
        where: { code: change.code },
        data: {
          description: change.incoming.description,
          ratePercent: change.incoming.ratePercent,
        },
      })
    );
  }

  const recordedChanges = plan.changedCodes
    .slice(0, AUDIT_CHANGE_LIMIT)
    .map((change) => ({
      code: change.code,
      before: change.current,
      after: {
        code: change.incoming.code,
        description: change.incoming.description,
        ratePercent: change.incoming.ratePercent,
      },
    }));

  operations.push(
    prisma.auditEvent.create({
      data: {
        actorId: null,
        action: "TAX_CODE_IMPORT",
        entityType: "TaxCodeImport",
        entityId: importId,
        afterData: {
          fileName,
          created: plan.newCodes.length,
          updated: plan.changedCodes.length,
          unchanged: plan.unchangedCodes.length,
          changesRecorded: recordedChanges.length,
          changesTruncated: plan.changedCodes.length > recordedChanges.length,
          changes: recordedChanges,
        },
      },
    })
  );

  const audit = await prisma.$transaction(operations);
  const auditEvent = audit[audit.length - 1] as { id: string };

  return {
    created: plan.newCodes.length,
    updated: plan.changedCodes.length,
    unchanged: plan.unchangedCodes.length,
    auditEventId: auditEvent.id,
  };
}
