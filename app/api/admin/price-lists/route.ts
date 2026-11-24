import { NextRequest } from "next/server";
import { adminMutation, failure, ok } from "@/lib/admin/route";
import { priceListCreateSchema } from "@/lib/admin/validation";
import { createPriceList } from "@/lib/admin/catalogue-admin";

/** POST /api/admin/price-lists -- create an empty price list (code and currency are permanent). */
export async function POST(request: NextRequest) {
  return adminMutation(request, priceListCreateSchema, async (input, actor) => {
    const result = await createPriceList(input, actor.id);
    return result.ok ? ok({ id: result.id }) : failure(result);
  });
}
