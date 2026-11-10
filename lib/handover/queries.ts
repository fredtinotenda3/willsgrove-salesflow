/**
 * Milestone 2C, extended in Milestone 3C. Read-side query for the
 * handover panel's "past handovers" list and the download route's
 * authorization lookup.
 */
import "server-only";
import { prisma } from "@/lib/prisma";

export async function listOrderHandovers(orderId: string) {
  const rows = await prisma.orderHandover.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reference: true,
      format: true,
      lineCount: true,
      matchedLineCount: true,
      unmatchedLineCount: true,
      originalFileName: true,
      fileSize: true,
      createdAt: true,
      generatedBy: { select: { id: true, name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    // Nullable only for a handover generated before Milestone 3C added
    // this field -- never backfilled, see OrderHandover.reference's
    // schema comment.
    reference: row.reference,
    format: row.format,
    lineCount: row.lineCount,
    matchedLineCount: row.matchedLineCount,
    unmatchedLineCount: row.unmatchedLineCount,
    originalFileName: row.originalFileName,
    fileSize: row.fileSize != null ? Number(row.fileSize) : null,
    createdAt: row.createdAt.toISOString(),
    generatedBy: row.generatedBy,
    downloadUrl: row.format !== "CLIPBOARD" ? `/api/orders/${orderId}/handover/${row.id}/download` : null,
  }));
}
