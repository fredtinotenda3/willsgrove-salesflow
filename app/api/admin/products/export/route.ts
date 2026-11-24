import { NextRequest } from "next/server";
import { adminRead } from "@/lib/admin/route";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/admin/csv";

/** GET /api/admin/products/export -- full product master as CSV. SAP item codes are exported untouched. ?template=1 returns the header row only. */
export async function GET(request: NextRequest) {
  return adminRead(async (actor) => {
    const header = ["sapItemCode", "itemName", "barcode", "category", "unitOfMeasure", "packSize", "vatCode", "isVariableWeight", "status"];
    const template = request.nextUrl.searchParams.get("template") === "1";
    const products = template ? [] : await prisma.product.findMany({ orderBy: { sapItemCode: "asc" }, select: { sapItemCode: true, itemName: true, barcode: true, category: true, unitOfMeasure: true, packSize: true, vatCode: true, isVariableWeight: true, status: true } });
    if (!template) await prisma.auditEvent.create({ data: { actorId: actor.id, action: "DATA_EXPORT", entityType: "Product", entityId: "export", afterData: { rows: products.length } } });
    const csv = toCsv(header, products.map((p) => header.map((h) => (p as Record<string, unknown>)[h])));
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${template ? "products-template" : "products"}.csv"`, "Cache-Control": "no-store" } });
  });
}
