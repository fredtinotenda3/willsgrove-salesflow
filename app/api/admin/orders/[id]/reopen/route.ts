import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { reasonOnlySchema } from "@/lib/admin/validation";
import { reopenOrder } from "@/lib/admin/order-admin";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/admin/orders/[id]/reopen -- a cancelled/rejected order that never reached SAP or invoicing returns to RECEIVED. */
export async function POST(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, reasonOnlySchema, async (input, actor) => {
    const result = await reopenOrder(id, input.reason, actor.id);
    return result.ok ? ok() : failure(result);
  });
}
