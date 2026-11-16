import { describe, it, expect, beforeAll } from "vitest";

/**
 * Final Operational Enhancements (spec Part 4). Tests for
 * lib/personnel-validation.ts's zod schemas and personnelRoleRequiresDetail().
 *
 * Unlike lib/picking/validation.ts and lib/fulfilment/validation.ts (whose
 * own header comments document a deliberate "no @prisma/client import"
 * convention specifically so they're unconditionally testable),
 * lib/personnel-validation.ts imports the real PersonnelRole/RecordStatus
 * enums from @prisma/client directly -- the SAME pattern the pre-existing
 * lib/user-validation.ts already uses (confirmed by inspection; neither
 * file is ever imported from a Client Component, only from server-only
 * API route handlers, so this is consistent, accepted architecture, not a
 * deviation introduced by this round).
 *
 * That has one consequence for THIS sandbox specifically, confirmed by
 * direct inspection rather than assumed: @prisma/client here is a stub
 * where `prisma generate` has not populated the real enum objects, so
 * `PersonnelRole`/`RecordStatus` import as `undefined` (not merely "the
 * client throws when constructed" -- the enums themselves are missing),
 * which makes `z.nativeEnum(undefined)` throw at MODULE LOAD time. A
 * plain top-of-file static import of lib/personnel-validation.ts would
 * therefore fail in this sandbox even though the module is correct and
 * will behave exactly as written once `prisma generate` has actually run
 * against the real schema (the identical sandbox-only gap documented in
 * every tests/*-db.integration.test.ts file in this project). This file
 * uses the same RUN_DB_INTEGRATION_TESTS gate and dynamic import for that
 * reason, even though no database connection is actually made below --
 * only a real generated @prisma/client is required.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Final Operational Enhancements Part 4: lib/personnel-validation.ts", () => {
  let createPersonnelSchema: typeof import("@/lib/personnel-validation").createPersonnelSchema;
  let updatePersonnelSchema: typeof import("@/lib/personnel-validation").updatePersonnelSchema;
  let personnelRoleRequiresDetail: typeof import("@/lib/personnel-validation").personnelRoleRequiresDetail;

  beforeAll(async () => {
    const mod = await import("@/lib/personnel-validation");
    createPersonnelSchema = mod.createPersonnelSchema;
    updatePersonnelSchema = mod.updatePersonnelSchema;
    personnelRoleRequiresDetail = mod.personnelRoleRequiresDetail;
  });

  describe("createPersonnelSchema", () => {
    it("accepts a minimal valid DRIVER with only name and role", () => {
      expect(createPersonnelSchema.safeParse({ name: "Tendai Moyo", role: "DRIVER" }).success).toBe(true);
    });

    it("accepts every optional field when supplied", () => {
      expect(
        createPersonnelSchema.safeParse({
          name: "Tendai Moyo",
          role: "DRIVER_ASSISTANT",
          roleDetail: "Also covers forklift duty",
          phone: "+263771234567",
          notes: "Prefers early shifts",
        }).success
      ).toBe(true);
    });

    it("rejects a missing or blank name", () => {
      expect(createPersonnelSchema.safeParse({ role: "DRIVER" }).success).toBe(false);
      expect(createPersonnelSchema.safeParse({ name: "   ", role: "DRIVER" }).success).toBe(false);
    });

    it("rejects a name over 150 characters", () => {
      expect(createPersonnelSchema.safeParse({ name: "x".repeat(151), role: "DRIVER" }).success).toBe(false);
    });

    it("rejects a role outside DRIVER/DRIVER_ASSISTANT/OTHER", () => {
      expect(createPersonnelSchema.safeParse({ name: "Tendai Moyo", role: "FORKLIFT_OPERATOR" }).success).toBe(false);
      expect(createPersonnelSchema.safeParse({ name: "Tendai Moyo" }).success).toBe(false);
    });

    it("rejects an overly long phone or notes", () => {
      expect(createPersonnelSchema.safeParse({ name: "x", role: "DRIVER", phone: "1".repeat(51) }).success).toBe(false);
      expect(createPersonnelSchema.safeParse({ name: "x", role: "DRIVER", notes: "x".repeat(2001) }).success).toBe(false);
    });
  });

  describe("updatePersonnelSchema", () => {
    it("accepts an empty body (every field optional on update)", () => {
      expect(updatePersonnelSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a status-only update (soft-deactivation)", () => {
      expect(updatePersonnelSchema.safeParse({ status: "INACTIVE" }).success).toBe(true);
      expect(updatePersonnelSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
    });

    it("rejects a status outside ACTIVE/INACTIVE", () => {
      expect(updatePersonnelSchema.safeParse({ status: "ARCHIVED" }).success).toBe(false);
    });

    it("still rejects a blank name when name IS supplied", () => {
      expect(updatePersonnelSchema.safeParse({ name: "" }).success).toBe(false);
    });
  });

  describe("personnelRoleRequiresDetail", () => {
    it("is true only for OTHER", () => {
      expect(personnelRoleRequiresDetail("OTHER")).toBe(true);
      expect(personnelRoleRequiresDetail("DRIVER")).toBe(false);
      expect(personnelRoleRequiresDetail("DRIVER_ASSISTANT")).toBe(false);
    });
  });
});
