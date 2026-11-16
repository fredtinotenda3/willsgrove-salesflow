import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { exceedsRequested, fullyAccountsFor } from "@/lib/picking/validation";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking),
 * extended by the Final Operational Enhancements (spec Part 2.1).
 *
 * Marks a PickingSession COMPLETED -- the first of the two gates the
 * spec's section 3 describes ("has not completed picking verification").
 * Requires every one of its lines to fully account for its
 * requestedQuantity (found + unavailable === requested); if any don't,
 * refuses with a message naming exactly which lines are incomplete,
 * rather than silently completing a partial pick.
 *
 * `lineEdits` (new, optional, defaults to none -- every pre-existing
 * caller that omits it sees exactly the prior behavior: only already-
 * persisted PickingLine values are checked) lets the caller atomically
 * save a batch of not-yet-individually-saved line edits together with
 * completion itself, in ONE transaction -- "save ALL entered records
 * together, not just already-individually-saved ones" (spec Part 2.1),
 * while leaving the existing per-line Save flow
 * (lib/picking/record-picked-line.ts, still called independently by
 * app/api/orders/[id]/picking/[sessionId]/lines/[lineId]/route.ts)
 * completely unchanged and still fully usable on its own. Validation is
 * identical either way: each edit is checked with the exact same
 * exceedsRequested()/fullyAccountsFor() this file and
 * record-picked-line.ts have always used, so a line saved via Complete
 * Picking is held to precisely the same found+unavailable<=requested and
 * found+unavailable===requested bars as one saved individually -- never a
 * looser bulk-path check. For a line NOT present in lineEdits, its
 * already-persisted value (if any) is what gets checked, exactly as
 * before.
 *
 * All-or-nothing: if ANY line (whether edited here or already persisted)
 * fails to fully account for its requested quantity, NOTHING is written
 * -- no partial save of some lines' edits followed by a refused
 * completion.
 *
 * Completion alone does NOT move the order to READY_TO_INVOICE or allow
 * handover generation -- per the user's confirmed design (two steps, same
 * roles), that only happens once a SALES_MANAGER or ADMINISTRATOR
 * separately authorizes it (lib/picking/authorize-picking.ts).
 */
export type CompletePickingResult =
  | { ok: true; session: { id: string; status: "COMPLETED"; completedAt: string } }
  | { ok: false; status: number; message: string };

export type CompletePickingLineEdit = {
  orderLineId: string;
  foundQuantity: string;
  unavailableQuantity: string;
  notes?: string;
};

export async function completePickingSession(
  sessionId: string,
  actorId: string,
  lineEdits: CompletePickingLineEdit[] = []
): Promise<CompletePickingResult> {
  const session = await prisma.pickingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      lines: {
        select: {
          id: true,
          orderLineId: true,
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

  const lineByOrderLineId = new Map(session.lines.map((line) => [line.orderLineId, line]));

  // Each requested edit must target a real line of THIS session, and must
  // not itself exceed that line's requested quantity -- the exact same
  // immediate check record-picked-line.ts applies to a single-line save,
  // just run here over every line in the batch before anything is written.
  const editByOrderLineId = new Map<string, CompletePickingLineEdit>();
  for (const edit of lineEdits) {
    const line = lineByOrderLineId.get(edit.orderLineId);
    if (!line) {
      return { ok: false, status: 400, message: `Order line ${edit.orderLineId} is not part of this picking session.` };
    }
    if (editByOrderLineId.has(edit.orderLineId)) {
      return { ok: false, status: 400, message: `Order line ${edit.orderLineId} was submitted more than once in this request.` };
    }
    const requestedText = line.requestedQuantity.toString();
    if (exceedsRequested(edit.foundQuantity, edit.unavailableQuantity, requestedText)) {
      return {
        ok: false,
        status: 400,
        message: `Line ${line.orderLine.lineNumber}: found (${edit.foundQuantity}) plus unavailable (${edit.unavailableQuantity}) cannot exceed the requested quantity (${requestedText}).`,
      };
    }
    editByOrderLineId.set(edit.orderLineId, edit);
  }

  // Effective found/unavailable per line: an edit in this batch overrides
  // whatever is already persisted; a line with no edit here is checked
  // against its already-persisted value, exactly as before this
  // function accepted lineEdits at all.
  const incompleteLineNumbers: number[] = [];
  for (const line of session.lines) {
    const edit = editByOrderLineId.get(line.orderLineId);
    const foundText = edit ? edit.foundQuantity : line.foundQuantity?.toString() ?? null;
    const unavailableText = edit ? edit.unavailableQuantity : line.unavailableQuantity?.toString() ?? null;
    const requestedText = line.requestedQuantity.toString();
    if (foundText === null || unavailableText === null || !fullyAccountsFor(foundText, unavailableText, requestedText)) {
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
    // Save every batched edit first -- each write + its audit event is the
    // same shape lib/picking/record-picked-line.ts already uses for an
    // individual save, so a line completed this way leaves an identical
    // audit trail to one saved by hand.
    for (const [orderLineId, edit] of editByOrderLineId) {
      const line = lineByOrderLineId.get(orderLineId)!;
      await tx.pickingLine.update({
        where: { id: line.id },
        data: {
          foundQuantity: new Prisma.Decimal(edit.foundQuantity),
          unavailableQuantity: new Prisma.Decimal(edit.unavailableQuantity),
          notes: edit.notes ?? null,
          pickedById: actorId,
          pickedAt: new Date(),
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "PICKING_LINE_RECORDED",
          entityType: "PickingLine",
          entityId: line.id,
          afterData: { pickingSessionId: sessionId, orderLineId, foundQuantity: edit.foundQuantity, unavailableQuantity: edit.unavailableQuantity, viaCompletePicking: true },
        },
      });
    }

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
        afterData: { lineCount: session.lines.length, linesSavedAtCompletion: editByOrderLineId.size },
      },
    });

    return result;
  }, TRANSACTION_OPTIONS);

  return {
    ok: true,
    session: { id: updated.id, status: "COMPLETED", completedAt: updated.completedAt!.toISOString() },
  };
}
