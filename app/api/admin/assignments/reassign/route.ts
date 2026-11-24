import { NextRequest } from "next/server";
import { adminMutation, failure, ok } from "@/lib/admin/route";
import { reassignSchema } from "@/lib/admin/validation";
import { executeReassignment, planReassignment } from "@/lib/admin/assignment-admin";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/assignments/reassign -- bulk reassignment.
 * confirm=false returns the preview (what would change / what is skipped and why)
 * and writes nothing; confirm=true re-derives the plan inside a transaction and applies it.
 */
export async function POST(request: NextRequest) {
  return adminMutation(request, reassignSchema, async (input, actor) => {
    if (!input.confirm) {
      const plan = await planReassignment(prisma, input.entityType, input.ids, input.toUserId);
      return "ok" in plan ? failure(plan) : ok({ preview: true, plan });
    }
    const result = await executeReassignment(input.entityType, input.ids, input.toUserId, input.reason, actor.id);
    return result.ok ? ok({ preview: false, applied: result.plan.eligible.length, skipped: result.plan.skipped }) : failure(result);
  });
}
