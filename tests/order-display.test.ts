import { describe, expect, it } from "vitest";
import { getEffectiveOrderStatus, getOrderLifecycleSteps, ORDER_STATUS_LABELS } from "@/lib/order-display";

/**
 * Final completion phase, section 7 ("an order must not remain stuck at
 * Ready for Invoice after it has progressed"). Covers
 * getEffectiveOrderStatus -- the pure, DB-free derivation that layers a
 * display-only Departed/Delivered label on top of READY_TO_INVOICE,
 * computed from already-recorded DispatchRecord statuses, without ever
 * changing the real stored OrderStatus.
 */
describe("getEffectiveOrderStatus", () => {
  it("passes every non-READY_TO_INVOICE status straight through, ignoring dispatchStatuses entirely", () => {
    for (const status of ["RECEIVED", "APPROVED", "PICKING", "REJECTED", "CANCELLED"] as const) {
      const result = getEffectiveOrderStatus({ status, dispatchStatuses: ["DELIVERED"] });
      expect(result.label).toBe(ORDER_STATUS_LABELS[status]);
    }
  });

  it("stays 'Ready to Invoice' when no dispatch has been created yet", () => {
    const result = getEffectiveOrderStatus({ status: "READY_TO_INVOICE", dispatchStatuses: [] });
    expect(result.label).toBe("Ready to Invoice");
  });

  it("stays 'Ready to Invoice' when every dispatch is still PLANNED (not yet departed)", () => {
    const result = getEffectiveOrderStatus({ status: "READY_TO_INVOICE", dispatchStatuses: ["PLANNED", "PLANNED"] });
    expect(result.label).toBe("Ready to Invoice");
  });

  it("becomes 'Delivered' once every non-cancelled dispatch is DELIVERED", () => {
    const result = getEffectiveOrderStatus({ status: "READY_TO_INVOICE", dispatchStatuses: ["DELIVERED"] });
    expect(result.label).toBe("Delivered");

    const multiDispatch = getEffectiveOrderStatus({ status: "READY_TO_INVOICE", dispatchStatuses: ["DELIVERED", "DELIVERED"] });
    expect(multiDispatch.label).toBe("Delivered");
  });

  it("becomes 'Departed' once at least one dispatch has left but not everything is confirmed delivered", () => {
    const departedOnly = getEffectiveOrderStatus({ status: "READY_TO_INVOICE", dispatchStatuses: ["DEPARTED"] });
    expect(departedOnly.label).toBe("Departed");

    // A second, still-planned dispatch batch for the same order -- the
    // exact "must not remain stuck" case: this order has genuinely moved
    // (one batch departed), so it must not still read "Ready to Invoice".
    const mixedPlannedAndDeparted = getEffectiveOrderStatus({ status: "READY_TO_INVOICE", dispatchStatuses: ["PLANNED", "DEPARTED"] });
    expect(mixedPlannedAndDeparted.label).toBe("Departed");

    // One batch delivered, another only departed -- not EVERY dispatch is
    // delivered yet, so this is "Departed" (in progress), not "Delivered".
    const mixedDepartedAndDelivered = getEffectiveOrderStatus({ status: "READY_TO_INVOICE", dispatchStatuses: ["DEPARTED", "DELIVERED"] });
    expect(mixedDepartedAndDelivered.label).toBe("Departed");
  });

  it("never mutates or references the real OrderStatus value for Departed/Delivered -- they are presentation-only labels", () => {
    // Confirms "Departed"/"Delivered" are not themselves keys this module
    // treats as real OrderStatus values anywhere (ORDER_STATUS_LABELS has
    // no such keys) -- the derivation layers a label on top, it never
    // invents a new status identifier.
    expect(Object.values(ORDER_STATUS_LABELS)).not.toContain("Departed");
    expect(Object.values(ORDER_STATUS_LABELS)).not.toContain("Delivered");
  });
});

/**
 * "Complete all that's left and partial" round. getOrderLifecycleSteps
 * (the stepper shown on the order and fulfilment detail pages) shipped
 * with no test coverage at all until now -- unlike
 * getEffectiveOrderStatus just above, which it sits right next to in
 * lib/order-display.ts. Covers: the three terminal statuses that opt out
 * entirely, every one of steps 0-4 reading straight off the stored
 * status, and the three independent after-freeze signals (hasMatchedInvoice,
 * a departed/delivered dispatch, delivered) each being able to push the
 * stage forward past READY_TO_INVOICE on their own -- and never backward.
 */
describe("getOrderLifecycleSteps", () => {
  const LIFECYCLE_STAGE_LABELS = ["Received", "Verification", "Approval", "Picking", "Ready for Invoice", "Invoiced", "Dispatched", "Delivered"];

  it("returns null for DRAFT, CANCELLED and REJECTED -- these never progress through a linear stepper", () => {
    for (const status of ["DRAFT", "CANCELLED", "REJECTED"]) {
      expect(getOrderLifecycleSteps({ status, dispatchStatuses: [], hasMatchedInvoice: false, delivered: false })).toBeNull();
    }
  });

  it("always returns all 8 stages, in the spec's fixed order, for a progressing order", () => {
    const steps = getOrderLifecycleSteps({ status: "RECEIVED", dispatchStatuses: [], hasMatchedInvoice: false, delivered: false });
    expect(steps).not.toBeNull();
    expect(steps!.map((s) => s.label)).toEqual(LIFECYCLE_STAGE_LABELS);
  });

  it("marks every stage before the current one 'done' and every stage after it 'upcoming', for each of steps 0-4", () => {
    const statusToStageIndex: Record<string, number> = {
      RECEIVED: 0,
      PENDING_VERIFICATION: 1,
      READY_FOR_APPROVAL: 2,
      APPROVED: 2,
      PICKING: 3,
      READY_TO_INVOICE: 4,
    };
    for (const [status, stageIndex] of Object.entries(statusToStageIndex)) {
      const steps = getOrderLifecycleSteps({ status, dispatchStatuses: [], hasMatchedInvoice: false, delivered: false })!;
      steps.forEach((step, index) => {
        if (index < stageIndex) expect(step.state).toBe("done");
        else if (index === stageIndex) expect(step.state).toBe("current");
        else expect(step.state).toBe("upcoming");
      });
    }
  });

  it("APPROVED and READY_FOR_APPROVAL both sit at the Approval stage -- APPROVED is not yet a step ahead", () => {
    const readyForApproval = getOrderLifecycleSteps({ status: "READY_FOR_APPROVAL", dispatchStatuses: [], hasMatchedInvoice: false, delivered: false })!;
    const approved = getOrderLifecycleSteps({ status: "APPROVED", dispatchStatuses: [], hasMatchedInvoice: false, delivered: false })!;
    expect(readyForApproval[2]!.state).toBe("current");
    expect(approved[2]!.state).toBe("current");
  });

  it("an unrecognised status string defaults to stage 0 (Received) rather than throwing", () => {
    const steps = getOrderLifecycleSteps({ status: "SOME_FUTURE_STATUS_NOT_YET_KNOWN", dispatchStatuses: [], hasMatchedInvoice: false, delivered: false })!;
    expect(steps[0]!.state).toBe("current");
  });

  it("hasMatchedInvoice alone pushes the stage to Invoiced (index 5), even while status is still READY_TO_INVOICE", () => {
    const steps = getOrderLifecycleSteps({ status: "READY_TO_INVOICE", dispatchStatuses: [], hasMatchedInvoice: true, delivered: false })!;
    expect(steps[5]!.state).toBe("current");
    expect(steps[4]!.state).toBe("done");
    expect(steps[6]!.state).toBe("upcoming");
  });

  it("a DEPARTED or DELIVERED dispatch status pushes the stage to Dispatched (index 6), independent of hasMatchedInvoice", () => {
    const departed = getOrderLifecycleSteps({ status: "READY_TO_INVOICE", dispatchStatuses: ["DEPARTED"], hasMatchedInvoice: false, delivered: false })!;
    expect(departed[6]!.state).toBe("current");

    const delivered = getOrderLifecycleSteps({ status: "READY_TO_INVOICE", dispatchStatuses: ["DELIVERED"], hasMatchedInvoice: false, delivered: false })!;
    expect(delivered[6]!.state).toBe("current");
  });

  it("a PLANNED-only dispatch does NOT push the stage past Ready for Invoice -- nothing has actually left yet", () => {
    const steps = getOrderLifecycleSteps({ status: "READY_TO_INVOICE", dispatchStatuses: ["PLANNED"], hasMatchedInvoice: false, delivered: false })!;
    expect(steps[4]!.state).toBe("current");
  });

  it("delivered=true pushes the stage all the way to Delivered (index 7), the final stage -- rendered 'done' (ticked), never 'current', since a delivered order has nothing left to progress to", () => {
    const steps = getOrderLifecycleSteps({ status: "READY_TO_INVOICE", dispatchStatuses: ["DELIVERED"], hasMatchedInvoice: true, delivered: true })!;
    expect(steps[7]!.state).toBe("done");
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  it("each signal only ever pushes the stage FORWARD, never backward past what the stored status already implies", () => {
    // RECEIVED (stage 0) with every after-freeze signal true: the real
    // workflow could never produce this (you cannot have a matched
    // invoice on a RECEIVED order), but the function's own contract is
    // Math.max at each step, not a reset -- so delivered=true still wins.
    const steps = getOrderLifecycleSteps({ status: "RECEIVED", dispatchStatuses: ["DELIVERED"], hasMatchedInvoice: true, delivered: true })!;
    expect(steps[7]!.state).toBe("done");
  });

  it("the final stage is 'done' only when it is actually the one reached -- an order still mid-transit (Dispatched, not yet Delivered) keeps 'current' on its own last-reached stage, index 6", () => {
    const steps = getOrderLifecycleSteps({ status: "READY_TO_INVOICE", dispatchStatuses: ["DEPARTED"], hasMatchedInvoice: true, delivered: false })!;
    expect(steps[6]!.state).toBe("current");
    expect(steps[7]!.state).toBe("upcoming");
  });
});
