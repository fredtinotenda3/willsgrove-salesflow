import "server-only";
import { prisma } from "@/lib/prisma";
import type { IntelligenceThresholds } from "@/lib/management-intelligence/thresholds";
import { resolveSettingValues, thresholdsFromValues, validateSettingChange, getSettingDefinition, type SettingValues } from "./settings-registry";

export async function getSettingValues(): Promise<SettingValues> {
  const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
  return resolveSettingValues(rows);
}

export async function getManagementThresholds(): Promise<IntelligenceThresholds> {
  return thresholdsFromValues(await getSettingValues());
}

export async function getStoredSettingKeys(): Promise<Map<string, { updatedAt: Date; updatedByName: string | null }>> {
  const rows = await prisma.systemSetting.findMany({ select: { key: true, updatedAt: true, updatedBy: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.key, { updatedAt: r.updatedAt, updatedByName: r.updatedBy?.name ?? null }]));
}

export type SettingMutationResult = { ok: true } | { ok: false; status: number; message: string };

const MIN_REASON = 3;

/**
 * Changes one setting. Validation (type, bounds, ordered pairs), the write
 * and the audit event (with the previous and new value and the stated
 * reason) commit in one transaction. `value: null` resets to the default.
 */
export async function changeSetting(args: { key: string; value: number | null; reason: string; actorId: string }): Promise<SettingMutationResult> {
  const def = getSettingDefinition(args.key);
  if (!def) return { ok: false, status: 400, message: "Unknown setting." };
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, status: 400, message: "Record the reason for the change." };

  return prisma.$transaction(async (tx) => {
    const rows = await tx.systemSetting.findMany({ select: { key: true, value: true } });
    const current = resolveSettingValues(rows);
    const before = current[def.key];

    const target = args.value === null ? def.defaultValue : args.value;
    // A reset is validated like any other value: it must not invert an ordered pair either.
    const check = validateSettingChange(def.key, target, current);
    if (!check.ok) return { ok: false as const, status: 400, message: check.message };
    if (check.value === before && (args.value !== null || !rows.some((r) => r.key === def.key))) {
      return { ok: false as const, status: 400, message: "The setting already has that value." };
    }

    if (args.value === null) {
      await tx.systemSetting.deleteMany({ where: { key: def.key } });
    } else {
      await tx.systemSetting.upsert({ where: { key: def.key }, create: { key: def.key, value: check.value, updatedById: args.actorId }, update: { value: check.value, updatedById: args.actorId } });
    }
    await tx.auditEvent.create({
      data: {
        actorId: args.actorId,
        action: args.value === null ? "SYSTEM_SETTING_RESET" : "SYSTEM_SETTING_UPDATE",
        entityType: "SystemSetting",
        entityId: def.key,
        beforeData: { value: before },
        afterData: { value: check.value, reason },
      },
    });
    return { ok: true as const };
  });
}
