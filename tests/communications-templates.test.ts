import { describe, it, expect } from "vitest";
import {
  renderQuotationIssued,
  renderQuotationResponseAcknowledged,
  renderOrderConfirmation,
  renderPickingUpdate,
  renderDispatchNotification,
  renderDeliveryConfirmation,
  renderDeliveryException,
} from "@/lib/communications/templates";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Unit tests for
 * lib/communications/templates.ts's pure message-body renderers --
 * unconditional (no @prisma/client dependency anywhere in this file's or
 * templates.ts's import graph), same convention as
 * tests/picking-validation.test.ts and tests/handover-format-rows.test.ts.
 * These renderers are deliberately simple string builders, so the tests
 * assert the facts that matter for a customer-facing message -- the right
 * identifiers and amounts appear, and the branches produce the expected
 * wording -- rather than matching the exact prose verbatim.
 */

const money = { amount: "1,250.00", currency: "USD" };

describe("renderQuotationIssued", () => {
  it("includes the quotation number, total, and valid-until date", () => {
    const { subject, bodyText } = renderQuotationIssued({
      customerName: "Acme Farms",
      quotationNumber: "QUO-0001",
      revisionNumber: 1,
      validUntil: new Date("2026-12-31T00:00:00.000Z"),
      total: money,
    });
    expect(subject).toContain("QUO-0001");
    expect(bodyText).toContain("Acme Farms");
    expect(bodyText).toContain("QUO-0001");
    expect(bodyText).toContain("USD 1,250.00");
    expect(bodyText).toContain("2026-12-31");
  });

  it("notes the revision number only when it is greater than 1", () => {
    const first = renderQuotationIssued({
      customerName: "Acme Farms",
      quotationNumber: "QUO-0001",
      revisionNumber: 1,
      validUntil: new Date(),
      total: money,
    });
    expect(first.subject).not.toContain("revision");
    expect(first.bodyText).not.toContain("revision");

    const revised = renderQuotationIssued({
      customerName: "Acme Farms",
      quotationNumber: "QUO-0001",
      revisionNumber: 2,
      validUntil: new Date(),
      total: money,
    });
    expect(revised.subject).toContain("revision 2");
    expect(revised.bodyText).toContain("revision 2");
  });
});

describe("renderQuotationResponseAcknowledged", () => {
  it("renders an ACCEPTED decision with forward-looking order language", () => {
    const { bodyText } = renderQuotationResponseAcknowledged({
      customerName: "Acme Farms",
      quotationNumber: "QUO-0001",
      decision: "ACCEPTED",
    });
    expect(bodyText).toContain("accepted");
    expect(bodyText).toContain("confirm your order");
  });

  it("renders a REJECTED decision without implying an order will follow", () => {
    const { bodyText } = renderQuotationResponseAcknowledged({
      customerName: "Acme Farms",
      quotationNumber: "QUO-0001",
      decision: "REJECTED",
    });
    expect(bodyText).toContain("declined");
    expect(bodyText).not.toContain("confirm your order");
    expect(bodyText).toContain("contact us");
  });
});

describe("renderOrderConfirmation", () => {
  it("includes the order reference and total", () => {
    const { subject, bodyText } = renderOrderConfirmation({
      customerName: "Acme Farms",
      orderReference: "SO-0042",
      total: money,
    });
    expect(subject).toContain("SO-0042");
    expect(bodyText).toContain("SO-0042");
    expect(bodyText).toContain("USD 1,250.00");
  });
});

describe("renderPickingUpdate", () => {
  it("includes the order reference and mentions authorisation for dispatch", () => {
    const { subject, bodyText } = renderPickingUpdate({ customerName: "Acme Farms", orderReference: "SO-0042" });
    expect(subject).toContain("SO-0042");
    expect(bodyText).toContain("authorised for dispatch");
  });
});

describe("renderDispatchNotification", () => {
  it("includes the vehicle/courier reference in parentheses when provided", () => {
    const { bodyText } = renderDispatchNotification({
      customerName: "Acme Farms",
      orderReference: "SO-0042",
      vehicleOrCourierReference: "TRUCK-07",
    });
    expect(bodyText).toContain("(TRUCK-07)");
  });

  it("omits the parenthetical entirely when no reference is given", () => {
    const { bodyText } = renderDispatchNotification({
      customerName: "Acme Farms",
      orderReference: "SO-0042",
      vehicleOrCourierReference: null,
    });
    expect(bodyText).not.toContain("(");
    expect(bodyText).toContain("dispatched and is on its way");
  });
});

describe("renderDeliveryConfirmation", () => {
  it("confirms delivery in full", () => {
    const { subject, bodyText } = renderDeliveryConfirmation({
      customerName: "Acme Farms",
      orderReference: "SO-0042",
    });
    expect(subject).toContain("delivered");
    expect(bodyText).toContain("delivered in full");
  });
});

describe("renderDeliveryException", () => {
  it("uses full-rejection wording and includes rejection notes when given", () => {
    const { bodyText } = renderDeliveryException({
      customerName: "Acme Farms",
      orderReference: "SO-0042",
      outcome: "FULLY_REJECTED",
      rejectionNotes: "All items damaged in transit",
    });
    expect(bodyText).toContain("could not be accepted and has been returned");
    expect(bodyText).toContain("Details: All items damaged in transit");
  });

  it("uses partial-rejection wording and omits the Details line when no notes are given", () => {
    const { bodyText } = renderDeliveryException({
      customerName: "Acme Farms",
      orderReference: "SO-0042",
      outcome: "PARTIALLY_REJECTED",
      rejectionNotes: null,
    });
    expect(bodyText).toContain("only partially accepted");
    expect(bodyText).not.toContain("Details:");
  });
});
