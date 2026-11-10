import "server-only";
import { prisma } from "@/lib/prisma";
import { fullyAccountsFor } from "@/lib/picking/validation";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 *
 * Marks a PickingSession COMPLETED -- the first of the two gates the
 * spec's section 3 describes ("has not completed picking verification").
 * Requires every one of its lines to fully account for its
 * requestedQuantity (found + unavailable === requested); if any don't,
 * refuses with a message naming exactly which lines are incomplete,
 * rather than silently completing a partial pick.
 *
 * Completion alone does NOT move the order to READY_TO_INVOICE or allow
 * handover generation -- per the user's confirmed design (two steps, same
 * roles), that only happens once a SALES_MANAGER or ADMINISTRATOR
 * separately authorizes it (lib/picking/authorize-picking.ts).
 */
export type CompletePickingResult =
  | { ok: true; session: { id: string; status: "COMPLETED"; completedAt: string } }
  | { ok: false; status: number; message: string };

export async function completePickingSession(sessionId: string, actorId: string): Promise<CompletePickingResult> {
  const session = await prisma.pickingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      lines: {
        select: {
          id: true,
          orderLine: { select: { lineNumber: true } },
          requestedQuantity: true,
          foundQuantity: true,
          unavailableQuantity: true,
        },
      },
    },
  });
  if (!session) {
    return { ok: false, status: 404, message: "Picking session not found." };
  }
  if (session.status !== "IN_PROGRESS") {
    return { ok: false, status: 409, message: "This picking session is not in progress." };
  }

  const incompleteLineNumbers: number[] = [];
  for (const line of session.lines) {
    const requestedText = line.requestedQuantity.toString();
    if (line.foundQuantity === null || line.unavailableQuantity === null) {
      incompleteLineNumbers.push(line.orderLine.lineNumber);
      continue;
    }
    if (!fullyAccountsFor(line.foundQuantity.toString(), line.unavailableQuantity.toString(), requestedText)) {
      incompleteLineNumbers.push(line.orderLine.lineNumber);
    }
  }

  if (incompleteLineNumbers.length > 0) {
    incompleteLineNumbers.sort((a, b) => a - b);
    return {
      ok: false,
      status: 400,
      message: `Picking is not ready to complete: line${incompleteLineNumbers.length > 1 ? "s" : ""} ${incompleteLineNumbers.join(", ")} ${
        incompleteLineNumbers.length > 1 ? "don't" : "doesn't"
      } yet have found + unavailable quantities that account for the full requested quantity.`,
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.pickingSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", completedById: actorId, completedAt: new Date() },
      select: { id: true, completedAt: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PICKING_SESSION_COMPLETED",
        entityType: "PickingSession",
        entityId: sessionId,
        afterData: { lineCount: session.lines.length },
      },
    });

    return result;
  });

  return {
    ok: true,
    session: { id: updated.id, status: "COMPLETED", completedAt: updated.completedAt!.toISOString() },
  };
}
