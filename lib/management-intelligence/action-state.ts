import { z } from "zod";

/**
 * The management action lifecycle (pure). A person moves an action; the
 * system never does. There is deliberately no automatic COMPLETED: an
 * action is completed only by a manager recording an outcome, and a
 * finding disappearing from the data is shown as an observation, not as a
 * completion.
 */

export const ACTION_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "COMPLETED", "DISMISSED"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  OPEN: "Not yet acknowledged",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  DISMISSED: "Dismissed",
};

export const ACTION_OPERATIONS = ["ACKNOWLEDGE", "ASSIGN", "START", "COMPLETE", "DISMISS", "REOPEN"] as const;
export type ActionOperation = (typeof ACTION_OPERATIONS)[number];

export type ActionEventType = "ACKNOWLEDGED" | "ASSIGNED" | "STARTED" | "COMPLETED" | "DISMISSED" | "REOPENED";

export const MIN_NOTE_LENGTH = 3;
export const MAX_NOTE_LENGTH = 1000;

export type TransitionContext = { hasAssignee: boolean; assigneeId: string | null; note: string | null };
export type TransitionResult = { ok: true; to: ActionStatus; eventType: ActionEventType } | { ok: false; message: string };

const fail = (message: string): TransitionResult => ({ ok: false, message });

export function applyOperation(from: ActionStatus, operation: ActionOperation, ctx: TransitionContext): TransitionResult {
  const note = ctx.note?.trim() ?? "";
  switch (operation) {
    case "ACKNOWLEDGE":
      return from === "OPEN" ? { ok: true, to: "ACKNOWLEDGED", eventType: "ACKNOWLEDGED" } : fail("Only an action that has not been acknowledged can be acknowledged.");
    case "ASSIGN":
      if (!ctx.assigneeId) return fail("Choose who the action is assigned to.");
      if (from === "COMPLETED" || from === "DISMISSED") return fail("Reopen the action before assigning it.");
      return { ok: true, to: from === "OPEN" ? "ACKNOWLEDGED" : from, eventType: "ASSIGNED" };
    case "START":
      if (from !== "ACKNOWLEDGED") return fail("Only an acknowledged action can be started.");
      if (!ctx.hasAssignee) return fail("Assign an owner before starting the action.");
      return { ok: true, to: "IN_PROGRESS", eventType: "STARTED" };
    case "COMPLETE":
      if (from !== "ACKNOWLEDGED" && from !== "IN_PROGRESS") return fail("Only an acknowledged or in-progress action can be completed.");
      if (note.length < MIN_NOTE_LENGTH) return fail("Record the outcome before completing the action.");
      return { ok: true, to: "COMPLETED", eventType: "COMPLETED" };
    case "DISMISS":
      if (from === "COMPLETED" || from === "DISMISSED") return fail("This action is already closed.");
      if (note.length < MIN_NOTE_LENGTH) return fail("Record the reason before dismissing the action.");
      return { ok: true, to: "DISMISSED", eventType: "DISMISSED" };
    case "REOPEN":
      return from === "COMPLETED" || from === "DISMISSED" ? { ok: true, to: "OPEN", eventType: "REOPENED" } : fail("Only a completed or dismissed action can be reopened.");
  }
}

export const managementActionRequestSchema = z.object({
  reportId: z.string().trim().min(1).max(60),
  findingKey: z.string().trim().min(1).max(200),
  operation: z.enum(ACTION_OPERATIONS),
  assigneeId: z.string().trim().min(1).max(64).optional(),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
});
export type ManagementActionRequest = z.infer<typeof managementActionRequestSchema>;

export function actionKey(reportId: string, findingKey: string): string {
  return `${reportId}:${findingKey}`;
}
