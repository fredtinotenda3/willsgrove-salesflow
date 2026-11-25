import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { deleteProduct } from "@/lib/admin/record-deletion";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/products/[id]/delete -- only a product never used on any document or price list; otherwise archive. */
export async function DELETE(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await deleteProduct(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
