import { adminRead } from "@/lib/admin/route";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/admin/csv";

/** GET /api/admin/customers/export -- customer master with account manager and price list. */
export async function GET() {
  return adminRead(async (actor) => {
    const rows = await prisma.customer.findMany({ orderBy: { name: "asc" }, select: { sapCustomerCode: true, name: true, email: true, phone: true, category: true, status: true, currencyCode: true, paymentTermsCode: true, accountManager: { select: { name: true } }, priceList: { select: { code: true } } } });
    await prisma.auditEvent.create({ data: { actorId: actor.id, action: "DATA_EXPORT", entityType: "Customer", entityId: "export", afterData: { rows: rows.length } } });
    const header = ["sapCustomerCode", "name", "email", "phone", "category", "status", "currencyCode", "paymentTermsCode", "accountManager", "priceListCode"];
    const csv = toCsv(header, rows.map((r) => [r.sapCustomerCode, r.name, r.email, r.phone, r.category, r.status, r.currencyCode, r.paymentTermsCode, r.accountManager?.name, r.priceList?.code]));
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="customers.csv"', "Cache-Control": "no-store" } });
  });
}
