import "server-only";
import { prisma } from "@/lib/prisma";
import { sanitizeSapErrorMessage } from "@/lib/integrations/sap/config";

/**
 * Milestone 9 (SAP Business One Integration). Reads and updates the
 * single `IntegrationConnection` row for SAP_B1 (spec section 6: admin-
 * only configuration, audited, no secret ever stored in this table or
 * logged). There is deliberately no seed for this row (see this
 * project's own Milestone 8 lesson, recorded in docs/milestones/
 * PROGRESS.md, about not extending prisma/seed.ts for rows a later
 * milestone's own code can create lazily) -- `getOrCreateConnection`
 * below creates the row with safe, fully-disabled defaults the first
 * time anything asks for it.
 */

const PROVIDER = "SAP_B1" as const;

export interface SapConnectionSummary {
  id: string;
  provider: "SAP_B1";
  mode: "MOCK" | "LIVE";
  enabled: boolean;
  baseUrl: string | null;
  companyDb: string | null;
  username: string | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastConnectionHealthCheckedAt: Date | null;
  updatedById: string | null;
  updatedAt: Date;
  createdAt: Date;
}

/**
 * Returns the existing row, or creates it with MOCK/disabled defaults.
 * Safe to call from any request path (including read-only dashboard
 * loads) -- never throws for "not configured yet," which is the normal
 * starting state for every deployment until Bulawayo supplies verified
 * Service Layer details.
 */
export async function getOrCreateConnection(): Promise<SapConnectionSummary> {
  const existing = await prisma.integrationConnection.findUnique({ where: { provider: PROVIDER } });
  if (existing) return existing;

  try {
    return await prisma.integrationConnection.create({
      data: { provider: PROVIDER, mode: "MOCK", enabled: false },
    });
  } catch {
    // Another concurrent request won the race to create the singleton
    // row first (provider is @unique) -- re-read rather than erroring.
    const raceWinner = await prisma.integrationConnection.findUnique({ where: { provider: PROVIDER } });
    if (raceWinner) return raceWinner;
    throw new Error("Failed to read or create the SAP integration connection row.");
  }
}

export interface UpdateConnectionInput {
  mode?: "MOCK" | "LIVE";
  enabled?: boolean;
  baseUrl?: string | null;
  companyDb?: string | null;
  username?: string | null;
}

/**
 * ADMINISTRATOR-only (enforced by the caller route via
 * requireUserOrResponse(["ADMINISTRATOR"]), not here) update of the
 * non-secret connection settings. The actual SAP_B1_PASSWORD is never a
 * parameter anywhere in this function -- it lives only in the server
 * environment (lib/integrations/sap/config.ts) and this table has no
 * column for it. Every call is audited with a before/after snapshot,
 * same convention as every other admin-configuration change in this
 * project (e.g. lib/approvals/policies.ts).
 */
export async function updateConnection(input: UpdateConnectionInput, updatedById: string): Promise<SapConnectionSummary> {
  const before = await getOrCreateConnection();

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.integrationConnection.update({
      where: { provider: PROVIDER },
      data: {
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.companyDb !== undefined ? { companyDb: input.companyDb } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        updatedById,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId: updatedById,
        action: "SAP_INTEGRATION_CONNECTION_UPDATED",
        entityType: "IntegrationConnection",
        entityId: row.id,
        beforeData: {
          mode: before.mode,
          enabled: before.enabled,
          baseUrl: before.baseUrl,
          companyDb: before.companyDb,
          username: before.username,
        },
        afterData: {
          mode: row.mode,
          enabled: row.enabled,
          baseUrl: row.baseUrl,
          companyDb: row.companyDb,
          username: row.username,
        },
      },
    });

    return row;
  });

  return updated;
}

/**
 * Records the outcome of a "Test connection" action (manual, ADMINISTRATOR-
 * triggered) or an automatic health check. `message` must already be
 * sanitized by the caller (the adapter's own testConnection()/
 * getConnectionHealth() implementation is responsible for that -- see
 * lib/integrations/sap/config.ts's sanitizeSapErrorMessage), but this
 * function re-sanitizes defensively before persisting, since this is the
 * last point before the value becomes visible in the dashboard UI.
 */
export async function recordConnectionTestResult(result: { ok: boolean; message: string }): Promise<void> {
  await prisma.integrationConnection.update({
    where: { provider: PROVIDER },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestMessage: sanitizeSapErrorMessage(result.message),
      lastConnectionHealthCheckedAt: new Date(),
    },
  });
}

/** Lighter-weight update for a background/automatic health check that
 * only refreshes the "last checked" timestamp and health flag, without
 * touching lastTestMessage/lastTestedAt (those are reserved for an
 * explicit, user-triggered "Test connection" click). */
export async function recordConnectionHealthCheck(ok: boolean): Promise<void> {
  await prisma.integrationConnection.update({
    where: { provider: PROVIDER },
    data: { lastConnectionHealthCheckedAt: new Date(), ...(ok ? {} : { lastTestOk: false }) },
  });
}
