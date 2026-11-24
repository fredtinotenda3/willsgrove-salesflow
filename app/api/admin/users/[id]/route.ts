import { NextRequest } from "next/server";
import { adminMutation, failure, invalidId, ok, routeId } from "@/lib/admin/route";
import { updateUserSchema } from "@/lib/admin/validation";
import { updateUserProfile } from "@/lib/admin/user-admin";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/users/[id] -- name, role, department. Administrator only. */
export async function PATCH(request: NextRequest, context: Ctx) {
  const id = await routeId(context);
  if (!id) return invalidId();
  return adminMutation(request, updateUserSchema, async (input, actor) => {
    const result = await updateUserProfile(id, input, actor.id);
    return result.ok ? ok({ changed: result.changed }) : failure(result);
  });
}
