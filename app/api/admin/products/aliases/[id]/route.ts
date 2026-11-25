import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { removeProductAlias } from "@/lib/admin/record-deletion";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/products/aliases/[id] -- removes one learned product alias (the mapping is relearned the next time it is confirmed). */
export async function DELETE(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await removeProductAlias(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
