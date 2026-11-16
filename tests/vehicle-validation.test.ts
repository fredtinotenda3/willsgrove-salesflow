import { describe, it, expect, beforeAll } from "vitest";

/**
 * Final Operational Enhancements (spec Part 4). Tests for
 * lib/vehicle-validation.ts's zod schemas -- same sandbox-gating rationale
 * as tests/personnel-validation.test.ts's own header comment (RecordStatus
 * imports as `undefined` from the stub @prisma/client in this sandbox,
 * which makes a static top-of-file import of this module throw at load
 * time; no database connection is actually required below, only a real
 * generated client).
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Final Operational Enhancements Part 4: lib/vehicle-validation.ts", () => {
  let createVehicleSchema: typeof import("@/lib/vehicle-validation").createVehicleSchema;
  let updateVehicleSchema: typeof import("@/lib/vehicle-validation").updateVehicleSchema;

  beforeAll(async () => {
    const mod = await import("@/lib/vehicle-validation");
    createVehicleSchema = mod.createVehicleSchema;
    updateVehicleSchema = mod.updateVehicleSchema;
  });

  describe("createVehicleSchema", () => {
    it("accepts a minimal valid body with only registrationNumber", () => {
      expect(createVehicleSchema.safeParse({ registrationNumber: "ABC-1234" }).success).toBe(true);
    });

    it("accepts every optional field when supplied", () => {
      expect(
        createVehicleSchema.safeParse({
          registrationNumber: "ABC-1234",
          description: "5-tonne refrigerated truck",
          notes: "Needs the lift gate checked monthly",
        }).success
      ).toBe(true);
    });

    it("rejects a missing or blank registrationNumber", () => {
      expect(createVehicleSchema.safeParse({}).success).toBe(false);
      expect(createVehicleSchema.safeParse({ registrationNumber: "   " }).success).toBe(false);
    });

    it("rejects a registrationNumber over 50 characters", () => {
      expect(createVehicleSchema.safeParse({ registrationNumber: "x".repeat(51) }).success).toBe(false);
    });

    it("rejects an overly long description or notes", () => {
      expect(createVehicleSchema.safeParse({ registrationNumber: "ABC-1234", description: "x".repeat(201) }).success).toBe(false);
      expect(createVehicleSchema.safeParse({ registrationNumber: "ABC-1234", notes: "x".repeat(2001) }).success).toBe(false);
    });
  });

  describe("updateVehicleSchema", () => {
    it("accepts an empty body (every field optional on update)", () => {
      expect(updateVehicleSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a status-only update (soft-deactivation)", () => {
      expect(updateVehicleSchema.safeParse({ status: "INACTIVE" }).success).toBe(true);
      expect(updateVehicleSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
    });

    it("rejects a status outside ACTIVE/INACTIVE", () => {
      expect(updateVehicleSchema.safeParse({ status: "RETIRED" }).success).toBe(false);
    });

    it("still rejects a blank registrationNumber when it IS supplied", () => {
      expect(updateVehicleSchema.safeParse({ registrationNumber: "" }).success).toBe(false);
    });
  });
});
