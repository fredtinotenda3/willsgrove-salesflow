import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { deletePriceList } from "@/lib/admin/record-deletion";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/price-lists/[id]/delete -- only an unassigned list with no entries used on any document; otherwise deactivate. */
export async function DELETE(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await deletePriceList(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
