import { NextRequest } from "next/server";
import { adminRead, invalidId, routeId } from "@/lib/admin/route";
import { exportCustomerPricesCsv } from "@/lib/pricing/customer-prices";
import { prisma } from "@/lib/prisma";
import { sanitizeFileName } from "@/lib/http";

/** GET /api/admin/customers/[id]/prices/export -- this customer's overrides as CSV (re-importable). ?template=1 returns the header only. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const customerId = await routeId(context);
  if (!customerId) return invalidId();
  return adminRead(async (actor) => {
    const exported = await exportCustomerPricesCsv(customerId);
    if (!exported) return Response.json({ success: false, message: "Customer not found." }, { status: 404 });
    const template = request.nextUrl.searchParams.get("template") === "1";
    const csv = template ? exported.csv.split("\r\n")[0] : exported.csv;
    if (!template) await prisma.auditEvent.create({ data: { actorId: actor.id, action: "DATA_EXPORT", entityType: "Customer", entityId: customerId, afterData: { export: "customer-prices" } } });
    const name = sanitizeFileName(`${template ? "customer-prices-template" : `prices-${exported.customerName}`}.csv`);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  });
}
