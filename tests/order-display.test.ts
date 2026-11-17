import { describe, expect, it } from "vitest";
import { getEffectiveOrderStatus, ORDER_STATUS_LABELS } from "@/lib/order-display";

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
