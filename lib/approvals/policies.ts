import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { actionTypeModule, type CreateApprovalPolicyInput, type UpdateApprovalPolicyInput } from "@/lib/approvals/validation";

/**
 * Milestone 8. Approval-policy CRUD -- spec section 5: "build a
 * practical way for authorised management users to configure approval
 * rules... avoid hardcoded business limits." No default policy rows
 * are ever created by application code -- `prisma/seed.ts` only ever
 * seeds Milestone 0's baseline (admin + demo customers + demo orders;
 * confirmed by reading its `main()`), the same as every milestone
 * since M1, so it was never extended here either. Gated integration
 * tests build their own `isDemo: true` policy rows directly via
 * `createApprovalPolicy`/Prisma instead -- "do not invent minimum
 * margins or discount limits" (spec section 4A) means the real
 * threshold is always management's own number, entered here, never
 * guessed by this codebase.
 */

export type MutationFailure = { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };
export type CreatePolicyResult = { ok: true; id: string } | MutationFailure;

export async function createApprovalPolicy(input: CreateApprovalPolicyInput, createdById: string, options?: { isDemo?: boolean }): Promise<CreatePolicyResult> {
  // Named `approvalModule`, not `module` -- assigning to a bare `module`
  // identifier collides with Next.js/webpack's own module-scope binding
  // (@next/next/no-assign-module-variable).
  const approvalModule = actionTypeModule(input.actionType);

  const created = await prisma.approvalPolicy.create({
    data: {
      module: approvalModule,
      actionType: input.actionType,
      name: input.name,
      description: input.description ?? null,
      thresholdPercent: input.actionType === "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD" ? new Prisma.Decimal(input.thresholdPercent) : null,
      thresholdAmount: input.actionType === "ORDER_VALUE_EXCEEDS_THRESHOLD" ? new Prisma.Decimal(input.thresholdAmount) : null,
      currency: input.actionType === "ORDER_VALUE_EXCEEDS_THRESHOLD" ? input.currency : null,
      requiredApproverRole: input.requiredApproverRole,
      allowRequesterSelfApprove: input.allowRequesterSelfApprove ?? false,
      overdueAfterHours: input.overdueAfterHours ?? null,
      effectiveFrom: input.effectiveFrom ? dateOnlyStringToUtcDate(input.effectiveFrom) : null,
      effectiveTo: input.effectiveTo ? dateOnlyStringToUtcDate(input.effectiveTo) : null,
      active: input.active ?? true,
      isDemo: options?.isDemo ?? false,
      createdById,
    },
    select: { id: true },
  });

  await prisma.auditEvent.create({
    data: { actorId: createdById, action: "APPROVAL_POLICY_CREATED", entityType: "ApprovalPolicy", entityId: created.id, afterData: { module: approvalModule, actionType: input.actionType, name: input.name } },
  });

  return { ok: true, id: created.id };
}

export type UpdatePolicyResult = { ok: true } | MutationFailure;

export async function updateApprovalPolicy(id: string, input: UpdateApprovalPolicyInput, actorId: string): Promise<UpdatePolicyResult> {
  const existing = await prisma.approvalPolicy.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { ok: false, status: 404, message: "Approval policy not found." };

  await prisma.approvalPolicy.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description === undefined ? undefined : input.description,
      thresholdPercent: input.thresholdPercent !== undefined ? new Prisma.Decimal(input.thresholdPercent) : undefined,
      thresholdAmount: input.thresholdAmount !== undefined ? new Prisma.Decimal(input.thresholdAmount) : undefined,
      currency: input.currency,
      requiredApproverRole: input.requiredApproverRole,
      allowRequesterSelfApprove: input.allowRequesterSelfApprove,
      overdueAfterHours: input.overdueAfterHours === undefined ? undefined : input.overdueAfterHours,
      effectiveFrom: input.effectiveFrom === undefined ? undefined : input.effectiveFrom ? dateOnlyStringToUtcDate(input.effectiveFrom) : null,
      effectiveTo: input.effectiveTo === undefined ? undefined : input.effectiveTo ? dateOnlyStringToUtcDate(input.effectiveTo) : null,
      active: input.active,
    },
  });

  await prisma.auditEvent.create({ data: { actorId, action: "APPROVAL_POLICY_UPDATED", entityType: "ApprovalPolicy", entityId: id, afterData: input as object } });

  return { ok: true };
}
