import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { statusReasonSchema } from "@/lib/admin/validation";
import { setPriceListStatus } from "@/lib/admin/catalogue-admin";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, statusReasonSchema, async (input, actor) => {
    const result = await setPriceListStatus(id, input.status, input.reason, actor.id);
    return result.ok ? ok({ changed: result.changed }) : failure(result);
  });
}
