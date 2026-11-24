import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { orderUpdateSchema } from "@/lib/admin/validation";
import { updateOrderDetails } from "@/lib/admin/order-admin";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/orders/[id] -- correct permitted details (PO reference, delivery date/address, notes) on orders not yet in fulfilment. */
export async function PATCH(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, orderUpdateSchema, async (input, actor) => {
    const result = await updateOrderDetails(id, input, actor.id);
    return result.ok ? ok({ changed: result.changed }) : failure(result);
  });
}
