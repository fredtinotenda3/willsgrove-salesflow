import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { passwordActionSchema } from "@/lib/admin/validation";
import { adminPasswordAction } from "@/lib/admin/user-admin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/password -- reset (new one-time temporary
 * password, returned once, no-store) or require a change at next login.
 */
export async function POST(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, passwordActionSchema, async (input, actor) => {
    const result = await adminPasswordAction(id, input.action, input.reason, actor.id);
    if (!result.ok) return failure(result);
    const response = ok({ temporaryPassword: result.temporaryPassword ?? null });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
