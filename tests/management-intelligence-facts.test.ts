import { describe, expect, it } from "vitest";
import { deliveryExceptionFacts, orderAgeFacts, outstandingOrderFacts, quotationFacts, shortageFacts } from "@/lib/management-intelligence/facts";
import type { OutstandingOrderRow, DeliveryExceptionRow } from "@/lib/reporting/management-reports";

const order = (reference: string, daysOutstanding: number | null): OutstandingOrderRow => ({ id: reference, reference, status: "Approved", customerName: "C", salespersonName: null, total: null, currency: "USD", receivedAt: null, daysOutstanding });
const exception = (customerName: string): DeliveryExceptionRow => ({ deliveryRecordId: customerName + Math.random(), orderId: "o", orderReference: "O", customerName, outcome: "PARTIALLY_REJECTED", recordedAt: "2026-11-01T00:00:00Z", rejectionNotes: [] });

describe("management intelligence facts mappers", () => {
  it("counts aged orders from the real rows and finds the oldest", () => {
    const f = outstandingOrderFacts({ rows: [order("A", 40), order("B", 20), order("C", 14), order("D", 3), order("E", null)], totalItems: 5 }, { byStatus: [{ status: "Approved", count: 4 }] });
    expect(f.agedCount).toBe(2); // 14 is not MORE than 14
    expect(f.criticalAgedCount).toBe(1); // only 40 > 30
    expect(f.oldestDays).toBe(40);
    expect(f.oldestReference).toBe("A");
    expect(f.topStatus).toEqual({ status: "Approved", count: 4 });
    expect(f.agedCountIsMinimum).toBe(false);
  });

  it("marks the aged count as a minimum when every examined row is aged and more exist", () => {
    const rows = Array.from({ length: 200 }, (_, i) => order(`O${i}`, 60));
    expect(orderAgeFacts({ rows, totalItems: 450 }, { byStatus: [] }, 14, 30).agedCountIsMinimum).toBe(true);
    expect(orderAgeFacts({ rows, totalItems: 200 }, { byStatus: [] }, 14, 30).agedCountIsMinimum).toBe(false);
  });

  it("handles an empty report", () => {
    const f = outstandingOrderFacts({ rows: [], totalItems: 0 }, { byStatus: [] });
    expect(f).toMatchObject({ totalOrders: 0, agedCount: 0, oldestDays: null, topStatus: null, agedCountIsMinimum: false });
  });

  it("groups delivery exceptions by customer, most first", () => {
    const f = deliveryExceptionFacts({ rows: [exception("B"), exception("A"), exception("A"), exception("A"), exception("B")], totalItems: 5 }, { byOutcome: [{ outcome: "FULLY_REJECTED", count: 1 }, { outcome: "PARTIALLY_REJECTED", count: 4 }] });
    expect(f.customers).toEqual([{ customerName: "A", count: 3 }, { customerName: "B", count: 2 }]);
    expect(f.fullyRejected).toBe(1);
    expect(f.partiallyRejected).toBe(4);
  });

  it("passes shortage breakdown figures through unchanged", () => {
    const top = [{ productDescription: "X", lineCount: 3, totalUnavailableQuantity: "9", totalUnavailableValue: "4.5", linesWithoutPrice: 1 }];
    expect(shortageFacts({ topProducts: top, totalLines: 3 })).toEqual({ totalLines: 3, topProducts: top });
  });

  it("falls back to a computed acceptance rate only from real counts", () => {
    const funnel = { quotationsIssued: 10, quotationsAccepted: 4, quotationsExpired: 1, quotationAcceptanceRatePercent: null, acceptedQuotationsInCohort: 4, acceptedQuotationsConvertedToOrder: 3, quotationToOrderConversionRatePercent: 75 } as never;
    const f = quotationFacts({ allTime: { issuedAwaitingResponse: 2, dueForFollowUp: 1 }, period: { dateFrom: "2026-11-01", dateTo: "2026-11-24", funnel } });
    expect(f.acceptanceRatePercent).toBe(40);
    expect(f.dueForFollowUpNow).toBe(1);
    const none = quotationFacts({ allTime: { issuedAwaitingResponse: 0, dueForFollowUp: 0 }, period: { dateFrom: "a", dateTo: "b", funnel: { ...(funnel as object), quotationsIssued: 0, quotationsAccepted: 0 } as never } });
    expect(none.acceptanceRatePercent).toBeNull();
  });
});
