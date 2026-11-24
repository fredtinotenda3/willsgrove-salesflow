import { NextRequest } from "next/server";
import { adminMutation, failure, ok } from "@/lib/admin/route";
import { reassignAllFromUserSchema } from "@/lib/admin/validation";
import { collectUserOwnedIds, executeReassignment, planReassignment } from "@/lib/admin/assignment-admin";
import { prisma } from "@/lib/prisma";
import type { ReassignEntityType } from "@/lib/admin/validation";

/** POST /api/admin/assignments/reassign-user -- hand all of one person's open work to another active user (leaver / inactive user). */
export async function POST(request: NextRequest) {
  return adminMutation(request, reassignAllFromUserSchema, async (input, actor) => {
    if (input.fromUserId === input.toUserId) return failure({ ok: false, status: 400, message: "Choose a different person to receive the work." });
    const owned = await collectUserOwnedIds(input.fromUserId, input.entityTypes);
    const types = input.entityTypes.filter((t) => owned[t].length > 0);
    if (types.length === 0) return ok({ preview: !input.confirm, applied: 0, perType: {} });
    if (!input.confirm) {
      const perType: Record<string, { eligible: number; skipped: number }> = {};
      for (const t of types) {
        const plan = await planReassignment(prisma, t, owned[t], input.toUserId);
        if ("ok" in plan) return failure(plan);
        perType[t] = { eligible: plan.eligible.length, skipped: plan.skipped.length };
      }
      return ok({ preview: true, perType });
    }
    const perType: Record<string, number> = {};
    for (const t of types as ReassignEntityType[]) {
      const result = await executeReassignment(t, owned[t], input.toUserId, input.reason, actor.id);
      if (!result.ok) {
        if (result.status === 409) { perType[t] = 0; continue; } // nothing eligible for this type
        return failure(result);
      }
      perType[t] = result.plan.eligible.length;
    }
    return ok({ preview: false, perType });
  });
}
