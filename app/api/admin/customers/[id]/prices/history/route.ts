import { NextRequest } from "next/server";
import { adminRead, invalidId, routeId } from "@/lib/admin/route";
import { listCustomerPriceHistory } from "@/lib/pricing/customer-prices";
import { isValidId } from "@/lib/http";

/** GET /api/admin/customers/[id]/prices/history?productId= -- append-only change history, newest first. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const customerId = await routeId(context);
  if (!customerId) return invalidId();
  const productId = request.nextUrl.searchParams.get("productId");
  if (productId && !isValidId(productId)) return invalidId();
  return adminRead(async () => Response.json({ success: true, history: await listCustomerPriceHistory(customerId, productId) }, { headers: { "Cache-Control": "no-store" } }));
}
