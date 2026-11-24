import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { productUpdateSchema } from "@/lib/admin/validation";
import { updateProduct } from "@/lib/admin/catalogue-admin";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, productUpdateSchema, async (input, actor) => {
    const result = await updateProduct(id, input, actor.id);
    return result.ok ? ok({ changed: result.changed }) : failure(result);
  });
}
