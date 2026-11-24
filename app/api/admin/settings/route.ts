import { NextRequest } from "next/server";
import { adminMutation, failure, ok } from "@/lib/admin/route";
import { settingSchema } from "@/lib/admin/validation";
import { changeSetting } from "@/lib/admin/settings-store";

/** POST /api/admin/settings -- change (or, with value null, reset) one registered setting. Unknown keys are rejected. */
export async function POST(request: NextRequest) {
  return adminMutation(request, settingSchema, async (input, actor) => {
    const result = await changeSetting({ key: input.key, value: input.value, reason: input.reason, actorId: actor.id });
    return result.ok ? ok() : failure(result);
  });
}
