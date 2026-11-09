/**
 * Milestone 2C. The one action that actually produces a handover --
 * manually triggered per order, per your approved scope (not automatic
 * on confirm, not a scheduled batch run). Every call is a real, append-
 * only OrderHandover row (never overwritten, never deduplicated -- same
 * convention as ExtractionRun), so regenerating a handover after a
 * correction keeps the history of what was handed over before.
 */
import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { buildHandoverRows, type HandoverOrderInfo, type HandoverRow } from "@/lib/handover/build-handover-rows";
import { rowsToCsvText, rowsToClipboardText } from "@/lib/handover/format-rows";

export type HandoverFormatValue = "EXCEL" | "CSV" | "CLIPBOARD";

export type GenerateHandoverResult =
  | {
      ok: true;
      handover: {
        id: string;
        format: HandoverFormatValue;
        lineCount: number;
        matchedLineCount: number;
        unmatchedLineCount: number;
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

async function buildExcelBuffer(order: HandoverOrderInfo, rows: HandoverRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Handover");

  sheet.addRow(["Order reference", order.reference]);
  sheet.addRow(["Customer", order.customerSapCode ? `${order.customerName} (${order.customerSapCode})` : order.customerName]);
  sheet.addRow(["Customer PO reference", order.customerPoReference ?? ""]);
  sheet.addRow(["Order date", order.orderDate ?? ""]);
  sheet.addRow(["Requested delivery date", order.requestedDeliveryDate ?? ""]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(["Line", "SAP Item Code", "Official Description", "Quantity", "Unit", "Original Description", "Note"]);
  headerRow.font = { bold: true };

  for (const row of rows) {
    sheet.addRow([row.lineNumber, row.sapItemCode ?? "", row.officialDescription ?? "", row.quantity, row.unit, row.originalDescription, row.note ?? ""]);
  }

  sheet.columns = [{ width: 6 }, { width: 16 }, { width: 40 }, { width: 10 }, { width: 8 }, { width: 40 }, { width: 55 }];

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

export async function generateHandover(
  orderId: string,
  actorId: string,
  format: HandoverFormatValue,
  options?: { isDemo?: boolean }
): Promise<GenerateHandoverResult> {
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }
  if (order.status === "CANCELLED" || order.status === "REJECTED") {
    return { ok: false, status: 409, message: "Cannot generate a handover for a cancelled or rejected order." };
  }

  const built = await buildHandoverRows(orderId);
  if (!built.ok) {
    return built;
  }
  const { order: orderInfo, rows } = built;

  const matchedLineCount = rows.filter((row) => row.matched).length;
  const unmatchedLineCount = rows.length - matchedLineCount;
  const isDemo = options?.isDemo ?? false;

  let storageKey: string | null = null;
  let originalFileName: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;
  let clipboardText: string | undefined;

  const storage = getStorageDriver();

  if (format === "EXCEL") {
    const buffer = await buildExcelBuffer(orderInfo, rows);
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
        select: { id: true, createdAt: true },
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
          afterData: { orderId, format, lineCount: rows.length, matchedLineCount, unmatchedLineCount },
        },
      });

      return created;
    });

    return {
      ok: true,
      handover: {
        id: handover.id,
        format,
        lineCount: rows.length,
        matchedLineCount,
        unmatchedLineCount,
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
    throw error;
  }
}
