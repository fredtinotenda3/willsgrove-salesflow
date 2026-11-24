import { NextRequest } from "next/server";
import { adminRead } from "@/lib/admin/route";
import { auditRowsToCsv, listAuditEvents } from "@/lib/admin/audit-queries";
import { parseAuditFilters } from "@/lib/admin/audit-filters";
import { prisma } from "@/lib/prisma";

const EXPORT_LIMIT = 5000;

/** GET /api/admin/audit/export -- filtered audit trail as CSV (read-only, capped, itself audited). */
export async function GET(request: NextRequest) {
  return adminRead(async (actor) => {
    const filters = parseAuditFilters(Object.fromEntries(request.nextUrl.searchParams));
    const { rows, total } = await listAuditEvents(filters, 1, EXPORT_LIMIT);
    await prisma.auditEvent.create({ data: { actorId: actor.id, action: "AUDIT_EXPORT", entityType: "AuditEvent", entityId: "export", afterData: { rows: rows.length, total, filters: request.nextUrl.search } } });
    return new Response(auditRowsToCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="audit-log.csv"', "Cache-Control": "no-store" } });
  });
}
