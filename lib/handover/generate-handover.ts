/**
 * Milestone 2C, reworked in Milestone 3C (SAP Invoice Handover
 * Specification). The one action that actually produces a handover --
 * manually triggered per order, per your approved scope (not automatic
 * on confirm, not a scheduled batch run). Every call is a real, append-
 * only OrderHandover row (never overwritten, never deduplicated -- same
 * convention as ExtractionRun), so regenerating a handover after a
 * correction keeps the history of what was handed over before.
 *
 * Milestone 3C changes: generates the spec's "Handover Reference" fresh
 * per call (generateHandoverReference(), below); the Excel file's header
 * now also carries that reference plus the picking-authorization
 * traceability (who, when) alongside the existing order/customer fields;
 * and the row itself records which PickingSession the quantities came
 * from (OrderHandover.pickingSessionId). The hard gate on
 * OrderStatus.READY_TO_INVOICE lives in buildHandoverRows (called below),
 * not duplicated here.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { isUniqueViolation, TRANSACTION_OPTIONS } from "@/lib/orders";
import { buildHandoverRows, type HandoverOrderInfo, type HandoverRow } from "@/lib/handover/build-handover-rows";
import { rowsToCsvText, rowsToClipboardText } from "@/lib/handover/format-rows";

export type HandoverFormatValue = "EXCEL" | "CSV" | "CLIPBOARD";

export type GenerateHandoverResult =
  | {
      ok: true;
      handover: {
        id: string;
        reference: string;
        format: HandoverFormatValue;
        lineCount: number;
        matchedLineCount: number;
        unmatchedLineCount: number;
        /** Lines that were 100% unavailable in picking and so never became a row at all -- per your confirmed "omit entirely" decision. Surfaced here so the omission is never *silent*, even though it's never a row. */
        omittedLineCount: number;
        createdAt: string;
        originalFileName?: string;
        downloadUrl?: string;
        /** Only set for CLIPBOARD -- nothing is ever stored as a file for that format, so this is the one place its content is returned at all. */
        clipboardText?: string;
      };
    }
  | { ok: false; status: number; message: string };

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV_MIME_TYPE = "text/csv; charset=utf-8";

/**
 * The spec's "Handover Reference" header field. Mirrors lib/orders.ts's
 * generateOrderReference() exactly -- same date+random shape, same
 * reason (human-scannable, astronomically unlikely to collide) -- just
 * with an "HND-" prefix instead of "ORD-" so the two are never confused
 * at a glance. Exported so tests can assert its shape without needing a
 * real generated handover.
 */
export function generateHandoverReference(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `HND-${datePart}-${randomPart}`;
}

async function buildExcelBuffer(order: HandoverOrderInfo, rows: HandoverRow[], handoverReference: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Handover");

  // The spec's "richer header" -- the original 5 order/customer fields,
  // plus this handover's own reference and the picking-authorization
  // traceability (who verified the picked quantities, and when), so the
  // document is self-contained evidence of that chain without needing to
  // look anything else up.
  sheet.addRow(["Handover Reference", handoverReference]);
  sheet.addRow(["Order Reference", order.reference]);
  sheet.addRow(["Customer", order.customerSapCode ? `${order.customerName} (${order.customerSapCode})` : order.customerName]);
  sheet.addRow(["Customer PO Reference", order.customerPoReference ?? ""]);
  sheet.addRow(["Order Date", order.orderDate ?? ""]);
  sheet.addRow(["Requested Delivery Date", order.requestedDeliveryDate ?? ""]);
  sheet.addRow(["Picking Authorized By", order.authorizedByName]);
  sheet.addRow(["Picking Authorized At", order.authorizedAt ? new Date(order.authorizedAt).toLocaleString() : ""]);
  sheet.addRow([]);

  // The spec's 4-column product table -- see lib/handover/format-rows.ts's
  // module comment for why the old Line/Original Description/Note columns
  // are gone from this grid specifically (not gone from the document: see
  // the "needing attention" section appended below when needed).
  const headerRow = sheet.addRow(["SAP Item Code", "Description", "Quantity", "Unit"]);
  headerRow.font = { bold: true };

  for (const row of rows) {
    sheet.addRow([row.sapItemCode ?? "", row.officialDescription ?? row.originalDescription, row.quantity, row.unit]);
  }

  const flagged = rows.filter((row) => row.note !== null);
  if (flagged.length > 0) {
    sheet.addRow([]);
    const flaggedHeaderRow = sheet.addRow(["Lines needing attention before processing"]);
    flaggedHeaderRow.font = { bold: true };
    const flaggedColumnRow = sheet.addRow(["SAP Item Code", "Description", "Reason"]);
    flaggedColumnRow.font = { italic: true };
    for (const row of flagged) {
      sheet.addRow([row.sapItemCode ?? "", row.officialDescription ?? row.originalDescription, row.note ?? ""]);
    }
  }

  sheet.columns = [{ width: 18 }, { width: 44 }, { width: 12 }, { width: 10 }];

  // Same root cause as lib/extraction/deterministic/excel.ts's read-side
  // cast (Milestone 2A): exceljs's own `index.d.ts` declares a bogus
  // ambient global `interface Buffer extends ArrayBuffer {}` that merges
  // with @types/node's real, generic `Buffer<TArrayBuffer>` global
  // interface. `writeBuffer()`'s declared return type is that broken
  // merged type, not a real Buffer -- `skipLibCheck` doesn't help here
  // either, for the same reason it didn't on the read side. Narrowly
  // scoped to this one call site; the value really is a Buffer at
  // runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const written = (await workbook.xlsx.writeBuffer()) as any;
  return Buffer.from(written);
}

const MAX_REFERENCE_ATTEMPTS = 5;

export async function generateHandover(
  orderId: string,
  actorId: string,
  format: HandoverFormatValue,
  options?: { isDemo?: boolean }
): Promise<GenerateHandoverResult> {
  const built = await buildHandoverRows(orderId);
  if (!built.ok) {
    return built;
  }
  const { order: orderInfo, rows, omittedLineCount } = built;

  const matchedLineCount = rows.filter((row) => row.matched).length;
  const unmatchedLineCount = rows.length - matchedLineCount;
  const isDemo = options?.isDemo ?? false;
  const storage = getStorageDriver();

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    const reference = generateHandoverReference();

    let storageKey: string | null = null;
    let originalFileName: string | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    let clipboardText: string | undefined;

    if (format === "EXCEL") {
      const buffer = await buildExcelBuffer(orderInfo, rows, reference);
      const stored = await storage.put(buffer, "xlsx");
      storageKey = stored.storageKey;
      originalFileName = `${orderInfo.reference}-handover.xlsx`;
      mimeType = EXCEL_MIME_TYPE;
      fileSize = stored.fileSize;
    } else if (format === "CSV") {
      const buffer = Buffer.from(rowsToCsvText(rows), "utf-8");
      const stored = await storage.put(buffer, "csv");
      storageKey = stored.storageKey;
      originalFileName = `${orderInfo.reference}-handover.csv`;
      mimeType = CSV_MIME_TYPE;
      fileSize = stored.fileSize;
    } else {
      clipboardText = rowsToClipboardText(rows);
    }

    try {
      const handover = await prisma.$transaction(async (tx) => {
        const created = await tx.orderHandover.create({
          data: {
            orderId,
            pickingSessionId: orderInfo.pickingSessionId,
            reference,
            format,
            generatedById: actorId,
            lineCount: rows.length,
            matchedLineCount,
            unmatchedLineCount,
            storageKey,
            originalFileName,
            mimeType,
            fileSize: fileSize != null ? BigInt(fileSize) : null,
            isDemo,
          },
          select: { id: true, reference: true, createdAt: true },
        });

        // Once-only marker: the FIRST handover of any format is "when this
        // order was first handed to SAP" -- a later regeneration (a
        // correction, a different format) never bumps it forward.
        await tx.customerOrder.updateMany({
          where: { id: orderId, handedToSapAt: null },
          data: { handedToSapAt: new Date() },
        });

        await tx.auditEvent.create({
          data: {
            actorId,
            action: "ORDER_HANDOVER_GENERATED",
            entityType: "OrderHandover",
            entityId: created.id,
            afterData: {
              orderId,
              format,
              reference,
              pickingSessionId: orderInfo.pickingSessionId,
              lineCount: rows.length,
              matchedLineCount,
              unmatchedLineCount,
              omittedLineCount,
            },
          },
        });

        return created;
      }, TRANSACTION_OPTIONS);

      return {
        ok: true,
        handover: {
          id: handover.id,
          reference: handover.reference ?? reference,
          format,
          lineCount: rows.length,
          matchedLineCount,
          unmatchedLineCount,
          omittedLineCount,
          createdAt: handover.createdAt.toISOString(),
          originalFileName: originalFileName ?? undefined,
          downloadUrl: storageKey ? `/api/orders/${orderId}/handover/${handover.id}/download` : undefined,
          clipboardText,
        },
      };
    } catch (error) {
      // The bytes (if any) are already on disk at this point -- same
      // orphan-avoidance pattern as app/api/orders/[id]/documents/route.ts.
      if (storageKey) {
        await storage.delete(storageKey).catch(() => {});
      }

      const target = isUniqueViolation(error) ? (error as Prisma.PrismaClientKnownRequestError).meta?.target : undefined;
      const targetsReference = Array.isArray(target) && target.includes("reference");
      if (targetsReference) {
        // Astronomically unlikely collision on the generated Handover
        // Reference (same odds as lib/orders.ts's own reference retry) --
        // retry with a freshly generated one rather than failing the
        // whole generation.
        continue;
      }

      throw error;
    }
  }

  return {
    ok: false,
    status: 500,
    message: "Could not generate a unique Handover Reference after several attempts. Please try again.",
  };
}
