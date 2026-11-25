import { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation, invalidId, routeId } from "@/lib/admin/route";
import { bulkSetCustomerPrices } from "@/lib/pricing/customer-prices";
import { isValidId } from "@/lib/http";

const schema = z.object({
  items: z.array(z.object({ productId: z.string().refine(isValidId, "Invalid id."), unitPrice: z.string().trim().max(20).nullable(), notes: z.string().trim().max(500).nullish() })).min(1).max(500),
  reason: z.string().trim().max(500).nullish(),
});

/** POST /api/admin/customers/[id]/prices/bulk -- all-or-nothing batch. A null/empty unitPrice removes that product's override. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const customerId = await routeId(context);
  if (!customerId) return invalidId();
  return adminMutation(request, schema, async (input, actor) => {
    const result = await bulkSetCustomerPrices(customerId, input.items, actor.id, input.reason ?? null, "BULK");
    return Response.json({ success: result.ok, message: result.ok ? undefined : result.message, results: result.results }, { status: result.ok ? 200 : result.status });
  });
}
