import "server-only";
import { prisma } from "@/lib/prisma";
import { SapAdapterError } from "@/lib/integrations/sap/types";
import type { Prisma } from "@prisma/client";

/**
 * Milestone 9 (SAP Business One Integration). Shared IntegrationSyncJob
 * lifecycle wrapper -- every one of lib/integrations/sap/{product,
 * customer,invoice,credit-note}-sync.ts and the outbox batch processor
 * goes through this instead of each hand-rolling its own
 * create/update(status) bookkeeping, so "one row per run, always moved
 * to a terminal state" (spec section 7's durability requirement) can't
 * drift between them.
 *
 * `isDemo` is deliberately never set to true anywhere in this module or
 * its callers -- it stays at the IntegrationSyncJob/IntegrationOperation
 * schema default of `false` for every real sync run, manual or
 * scheduled. That mirrors the existing Milestone 1/5/6B import execute
 * functions (lib/product-import.ts, lib/invoice-reconciliation/execute-
 * import.ts, etc.), none of which ever set isDemo themselves either --
 * there is no demo-data generator for SAP integration rows in this
 * milestone, consistent with the Milestone 8 lesson (documented in
 * docs/milestones/PROGRESS.md) against extending prisma/seed.ts for a
 * later milestone's own rows.
 */

export type SyncJobOutcome<TSummary> =
  | { status: "COMPLETED"; summary: TSummary }
  | { status: "PARTIAL"; summary: TSummary; errorMessage: string }
  | { status: "FAILED"; errorMessage: string };

export interface SyncJobRecord {
  id: string;
  status: string;
  summary: Prisma.JsonValue | null;
  errorMessage: string | null;
}

/**
 * Creates the IntegrationSyncJob row, runs `work`, and always moves the
 * job to a terminal status (COMPLETED/PARTIAL/FAILED) before returning
 * -- `work` itself decides which of those three outcomes applies (a
 * PARTIAL run, e.g. "47 of 50 lines imported, 3 failed validation," is
 * not an exception; a genuinely unexpected error -- including any
 * SapAdapterError the adapter call itself throws -- is caught here and
 * recorded as FAILED). Never throws: callers (an API route, or
 * scripts/sap-sync.ts) always get back a SyncJobRecord to report,
 * whichever way the run went.
 */
export async function runIntegrationSyncJob<TSummary extends Prisma.InputJsonValue>(
  jobType: "PRODUCT_IMPORT" | "CUSTOMER_IMPORT" | "INVOICE_IMPORT" | "CREDIT_NOTE_IMPORT" | "SALES_ORDER_OUTBOX",
  trigger: "MANUAL" | "SCHEDULED",
  triggeredById: string | null,
  work: () => Promise<SyncJobOutcome<TSummary>>
): Promise<SyncJobRecord> {
  const job = await prisma.integrationSyncJob.create({
    data: { jobType, trigger, triggeredById, status: "RUNNING", startedAt: new Date() },
  });

  let outcome: SyncJobOutcome<TSummary>;
  try {
    outcome = await work();
  } catch (error) {
    const message = error instanceof SapAdapterError ? error.message : error instanceof Error ? error.message : String(error);
    outcome = { status: "FAILED", errorMessage: message };
  }

  const updated = await prisma.integrationSyncJob.update({
    where: { id: job.id },
    data: {
      status: outcome.status,
      completedAt: new Date(),
      summary: outcome.status === "FAILED" ? undefined : outcome.summary,
      errorMessage: outcome.status === "COMPLETED" ? null : outcome.errorMessage,
    },
    select: { id: true, status: true, summary: true, errorMessage: true },
  });

  return updated;
}
