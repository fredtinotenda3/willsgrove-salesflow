import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { userStatusSchema } from "@/lib/admin/validation";
import { setUserStatus } from "@/lib/admin/user-admin";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/admin/users/[id]/status -- activate / deactivate with a recorded reason; sessions are ended on deactivation. */
export async function POST(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, userStatusSchema, async (input, actor) => {
    const result = await setUserStatus(id, input.status, input.reason, actor.id);
    return result.ok ? ok({ changed: result.changed }) : failure(result);
  });
}
