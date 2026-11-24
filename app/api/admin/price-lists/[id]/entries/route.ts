import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { priceEntryCreateSchema } from "@/lib/admin/validation";
import { createPriceEntry } from "@/lib/admin/catalogue-admin";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/admin/price-lists/[id]/entries -- add a price (exact decimal, own validity window, no overlap for the same item). */
export async function POST(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, priceEntryCreateSchema, async (input, actor) => {
    const result = await createPriceEntry(id, input, actor.id);
    return result.ok ? ok({ id: result.id }) : failure(result);
  });
}
