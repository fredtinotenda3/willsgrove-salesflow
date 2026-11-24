import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { deletePriceEntry } from "@/lib/admin/catalogue-admin";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/price-lists/entries/[id] -- remove one price; historical order/quotation prices are snapshots and unaffected. */
export async function DELETE(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await deletePriceEntry(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
