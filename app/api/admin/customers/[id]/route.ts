import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { deleteCustomer } from "@/lib/admin/record-deletion";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/customers/[id] -- only a customer with no orders, quotations, invoices, claims, messages or stock history; otherwise deactivate. */
export async function DELETE(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await deleteCustomer(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
