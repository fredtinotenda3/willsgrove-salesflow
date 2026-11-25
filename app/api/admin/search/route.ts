import { NextRequest } from "next/server";
import { adminRead } from "@/lib/admin/route";
import { adminSearch } from "@/lib/admin/search";

/** GET /api/admin/search?q= -- administrator-only cross-entity lookup (orders, customers, products, quotations, claims, invoices, users). */
export async function GET(request: NextRequest) {
  return adminRead(async () => {
    const hits = await adminSearch(request.nextUrl.searchParams.get("q") ?? "");
    return Response.json({ success: true, hits }, { headers: { "Cache-Control": "no-store" } });
  });
}
