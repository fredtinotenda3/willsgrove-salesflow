import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { priceListUpdateSchema } from "@/lib/admin/validation";
import { updatePriceList } from "@/lib/admin/catalogue-admin";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, priceListUpdateSchema, async (input, actor) => {
    const result = await updatePriceList(id, input.name, input.reason, actor.id);
    return result.ok ? ok({ changed: result.changed }) : failure(result);
  });
}
