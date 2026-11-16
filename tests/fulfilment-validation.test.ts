import { describe, it, expect } from "vitest";
import {
  createDispatchSchema,
  departDispatchSchema,
  cancelDispatchSchema,
  recordDeliveryLineSchema,
  recordDeliverySchema,
} from "@/lib/fulfilment/validation";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Unit tests for
 * lib/fulfilment/validation.ts's zod request schemas -- unconditional (no
 * @prisma/client dependency anywhere in this file's or validation.ts's
 * import graph), same convention as tests/picking-validation.test.ts.
 *
 * Final Operational Enhancements (spec Part 3.3) made driverId/
 * assistantId/vehicleId REQUIRED on createDispatchSchema -- every "valid
 * body" fixture below was updated to include them (a body missing any one
 * of the three is no longer valid), and a dedicated describe block below
 * covers the new required-field rejections.
 */
const VALID_DRIVER_ASSISTANT_VEHICLE = { driverId: "driver-1", assistantId: "assistant-1", vehicleId: "vehicle-1" };

describe("createDispatchSchema", () => {
  it("accepts a minimal valid body with only the required fields", () => {
    const parsed = createDispatchSchema.safeParse({
      lines: [{ orderLineId: "line-1", quantity: "10" }],
      ...VALID_DRIVER_ASSISTANT_VEHICLE,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts every optional field when supplied", () => {
    const parsed = createDispatchSchema.safeParse({
      lines: [{ orderLineId: "line-1", quantity: "10.5" }],
      ...VALID_DRIVER_ASSISTANT_VEHICLE,
      vehicleOrCourierReference: "TRUCK-01",
      plannedDepartureAt: new Date().toISOString(),
      notes: "Handle with care",
      pickingSessionId: "session-1",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty lines array", () => {
    expect(createDispatchSchema.safeParse({ lines: [], ...VALID_DRIVER_ASSISTANT_VEHICLE }).success).toBe(false);
  });

  it("rejects a missing or malformed line quantity", () => {
    expect(
      createDispatchSchema.safeParse({ lines: [{ orderLineId: "line-1" }], ...VALID_DRIVER_ASSISTANT_VEHICLE }).success
    ).toBe(false);
    expect(
      createDispatchSchema.safeParse({ lines: [{ orderLineId: "line-1", quantity: "-1" }], ...VALID_DRIVER_ASSISTANT_VEHICLE })
        .success
    ).toBe(false);
    expect(
      createDispatchSchema.safeParse({ lines: [{ orderLineId: "line-1", quantity: "1.23456" }], ...VALID_DRIVER_ASSISTANT_VEHICLE })
        .success
    ).toBe(false);
  });

  it("rejects an invalid plannedDepartureAt", () => {
    expect(
      createDispatchSchema.safeParse({
        lines: [{ orderLineId: "line-1", quantity: "10" }],
        ...VALID_DRIVER_ASSISTANT_VEHICLE,
        plannedDepartureAt: "not-a-date",
      }).success
    ).toBe(false);
  });

  /**
   * Final Operational Enhancements (spec Part 3.3): "every confirmed
   * dispatch must record Driver, Driver's Assistant, and Truck
   * Registration" -- all three required, each independently.
   */
  describe("driver/assistant/vehicle are each required", () => {
    const baseBody = { lines: [{ orderLineId: "line-1", quantity: "10" }] };

    it("rejects a body missing driverId", () => {
      const { driverId, ...rest } = VALID_DRIVER_ASSISTANT_VEHICLE;
      void driverId;
      expect(createDispatchSchema.safeParse({ ...baseBody, ...rest }).success).toBe(false);
    });

    it("rejects a body missing assistantId", () => {
      const { assistantId, ...rest } = VALID_DRIVER_ASSISTANT_VEHICLE;
      void assistantId;
      expect(createDispatchSchema.safeParse({ ...baseBody, ...rest }).success).toBe(false);
    });

    it("rejects a body missing vehicleId", () => {
      const { vehicleId, ...rest } = VALID_DRIVER_ASSISTANT_VEHICLE;
      void vehicleId;
      expect(createDispatchSchema.safeParse({ ...baseBody, ...rest }).success).toBe(false);
    });

    it("rejects an empty-string driverId/assistantId/vehicleId (min(1) on each)", () => {
      expect(
        createDispatchSchema.safeParse({ ...baseBody, ...VALID_DRIVER_ASSISTANT_VEHICLE, driverId: "" }).success
      ).toBe(false);
      expect(
        createDispatchSchema.safeParse({ ...baseBody, ...VALID_DRIVER_ASSISTANT_VEHICLE, assistantId: "" }).success
      ).toBe(false);
      expect(
        createDispatchSchema.safeParse({ ...baseBody, ...VALID_DRIVER_ASSISTANT_VEHICLE, vehicleId: "" }).success
      ).toBe(false);
    });
  });
});

describe("departDispatchSchema", () => {
  it("accepts an empty body (the field is optional)", () => {
    expect(departDispatchSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a vehicle/courier reference up to 200 chars and rejects longer", () => {
    expect(departDispatchSchema.safeParse({ vehicleOrCourierReference: "x".repeat(200) }).success).toBe(true);
    expect(departDispatchSchema.safeParse({ vehicleOrCourierReference: "x".repeat(201) }).success).toBe(false);
  });
});

describe("cancelDispatchSchema", () => {
  it("requires a non-empty reason", () => {
    expect(cancelDispatchSchema.safeParse({ reason: "Customer cancelled the order" }).success).toBe(true);
    expect(cancelDispatchSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(cancelDispatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an overly long reason", () => {
    expect(cancelDispatchSchema.safeParse({ reason: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("recordDeliveryLineSchema", () => {
  it("accepts a valid line with both quantities and no rejection reason", () => {
    expect(
      recordDeliveryLineSchema.safeParse({ dispatchLineId: "dl-1", acceptedQuantity: "10", rejectedQuantity: "0" })
        .success
    ).toBe(true);
  });

  it("accepts a rejection reason when supplied", () => {
    expect(
      recordDeliveryLineSchema.safeParse({
        dispatchLineId: "dl-1",
        acceptedQuantity: "8",
        rejectedQuantity: "2",
        rejectionReason: "Damaged in transit",
      }).success
    ).toBe(true);
  });

  it("rejects a missing or malformed quantity", () => {
    expect(recordDeliveryLineSchema.safeParse({ dispatchLineId: "dl-1", acceptedQuantity: "10" }).success).toBe(
      false
    );
    expect(
      recordDeliveryLineSchema.safeParse({ dispatchLineId: "dl-1", acceptedQuantity: "-1", rejectedQuantity: "0" })
        .success
    ).toBe(false);
  });

  // Note: this schema only validates shape -- the business rule that a
  // rejection reason is REQUIRED once rejectedQuantity > 0, and that
  // accepted + rejected must equal the dispatched quantity, is enforced
  // by lib/fulfilment/delivery.ts's recordDelivery (which needs the
  // dispatch line's dispatchedQuantity from the database to check it),
  // not by this zod schema.
});

describe("recordDeliverySchema", () => {
  it("accepts a minimal valid body", () => {
    expect(
      recordDeliverySchema.safeParse({
        lines: [{ dispatchLineId: "dl-1", acceptedQuantity: "10", rejectedQuantity: "0" }],
      }).success
    ).toBe(true);
  });

  it("rejects an empty lines array", () => {
    expect(recordDeliverySchema.safeParse({ lines: [] }).success).toBe(false);
  });

  it("accepts optional recipientName and notes", () => {
    expect(
      recordDeliverySchema.safeParse({
        lines: [{ dispatchLineId: "dl-1", acceptedQuantity: "10", rejectedQuantity: "0" }],
        recipientName: "J. Moyo",
        notes: "Left at reception",
      }).success
    ).toBe(true);
  });
});
