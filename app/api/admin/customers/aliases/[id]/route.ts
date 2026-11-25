import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { removeCustomerAlias } from "@/lib/admin/customer-admin";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/customers/aliases/[id] -- removes one learned customer alias (the mapping is relearned the next time it is confirmed). */
export async function DELETE(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await removeCustomerAlias(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
