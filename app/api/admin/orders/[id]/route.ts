import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { orderUpdateSchema } from "@/lib/admin/validation";
import { updateOrderDetails } from "@/lib/admin/order-admin";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { deleteDraftOrder } from "@/lib/admin/record-deletion";

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

/** DELETE /api/admin/orders/[id] -- hard-deletes an unreferenced DRAFT order only; every other order is cancelled, never deleted. Dependencies are re-checked inside the transaction. */
export async function DELETE(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await deleteDraftOrder(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
