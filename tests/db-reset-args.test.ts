import { describe, expect, it } from "vitest";
import {
  CONFIRM_PHRASE,
  FULL_RESET_CONFIRM_PHRASE,
  checkRealRunGuards,
  parseResetArgs,
  totalOfCounts,
} from "@/lib/db-reset-args";

/**
 * Task 177 (Data-cleanup dependency map + safe reset script), extended for
 * the full reset-to-User-and-Product tool. Covers the pure
 * argument-parsing and confirmation-guard logic that
 * scripts/reset-operational-data.ts and
 * scripts/reset-to-user-and-product.ts rely on to stay admin-gated,
 * backup-required, confirmation-required, and guarded against a stale or
 * copy-pasted invocation -- all without touching a database. The
 * database-dependent parts of those scripts (validating the actor against
 * the User table, counting rows, running the transaction) are not
 * unit-testable in this sandbox (no live Prisma client) and are instead
 * covered by careful manual FK-order verification documented in
 * lib/db-reset-operations.ts's doc comments.
 */
describe("parseResetArgs", () => {
  it("parses --dry-run as a boolean flag with no value", () => {
    const args = parseResetArgs(["--actor=user-1", "--dry-run"]);
    expect(args.dryRun).toBe(true);
    expect(args.actor).toBe("user-1");
  });

  it("defaults dryRun to false when --dry-run is absent", () => {
    const args = parseResetArgs(["--actor=user-1"]);
    expect(args.dryRun).toBe(false);
  });

  it("parses every --key=value flag this script recognizes", () => {
    const args = parseResetArgs([
      "--actor=admin-1",
      '--backup-reference=Neon branch snapshot taken 2026-11-17',
      `--confirm=${CONFIRM_PHRASE}`,
      "--confirm-total-rows=42",
    ]);
    expect(args.actor).toBe("admin-1");
    expect(args.backupReference).toBe("Neon branch snapshot taken 2026-11-17");
    expect(args.confirm).toBe(CONFIRM_PHRASE);
    expect(args.confirmTotalRows).toBe(42);
  });

  it("preserves '=' characters inside a flag's value (e.g. a connection string in --backup-reference)", () => {
    const args = parseResetArgs(["--backup-reference=snapshot id=br-abc123, taken=2026-11-17"]);
    expect(args.backupReference).toBe("snapshot id=br-abc123, taken=2026-11-17");
  });

  it("sets confirmTotalRows to NaN (not undefined) for a non-numeric value, so the caller can distinguish 'missing' from 'malformed'", () => {
    const args = parseResetArgs(["--confirm-total-rows=not-a-number"]);
    expect(args.confirmTotalRows).not.toBeUndefined();
    expect(Number.isNaN(args.confirmTotalRows)).toBe(true);
  });

  it("accepts a zero total (the idempotent/already-empty case)", () => {
    const args = parseResetArgs(["--confirm-total-rows=0"]);
    expect(args.confirmTotalRows).toBe(0);
  });

  it("rejects a negative number for --confirm-total-rows (the \\d+ pattern has no sign)", () => {
    const args = parseResetArgs(["--confirm-total-rows=-5"]);
    expect(Number.isNaN(args.confirmTotalRows)).toBe(true);
  });

  it("ignores unrecognized flags and bare positional arguments", () => {
    const args = parseResetArgs(["--unknown-flag=value", "positional", "--actor=user-1"]);
    expect(args.actor).toBe("user-1");
  });
});

describe("totalOfCounts", () => {
  it("sums every value in the counts record", () => {
    expect(totalOfCounts({ a: 3, b: 5, c: 0 })).toBe(8);
  });

  it("returns 0 for an empty counts record (fully-wiped / never-seeded database)", () => {
    expect(totalOfCounts({})).toBe(0);
  });
});

describe("checkRealRunGuards", () => {
  const validArgs = () => ({
    actor: "admin-1",
    dryRun: false,
    backupReference: "Neon branch snapshot br-abc123 taken 2026-11-17T14:00Z",
    confirm: CONFIRM_PHRASE,
    confirmTotalRows: 10,
  });

  it("passes when every gate is satisfied and the total matches", () => {
    const result = checkRealRunGuards(validArgs(), 10);
    expect(result.ok).toBe(true);
  });

  it("refuses when --backup-reference is missing", () => {
    const args = validArgs();
    delete (args as { backupReference?: string }).backupReference;
    const result = checkRealRunGuards(args, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/backup-reference/);
  });

  it("refuses when --backup-reference is only whitespace", () => {
    const result = checkRealRunGuards({ ...validArgs(), backupReference: "   " }, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/backup-reference/);
  });

  it("refuses when --confirm does not exactly match the required phrase", () => {
    const result = checkRealRunGuards({ ...validArgs(), confirm: "reset operational data" }, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/--confirm must be exactly/);
  });

  it("refuses when --confirm-total-rows is missing", () => {
    const args = validArgs();
    delete (args as { confirmTotalRows?: number }).confirmTotalRows;
    const result = checkRealRunGuards(args, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/confirm-total-rows/);
  });

  it("refuses when --confirm-total-rows is NaN (malformed input)", () => {
    const result = checkRealRunGuards({ ...validArgs(), confirmTotalRows: NaN }, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/confirm-total-rows/);
  });

  it("refuses when --confirm-total-rows does not match a freshly recounted total -- the stale/copy-pasted-command guard", () => {
    const result = checkRealRunGuards({ ...validArgs(), confirmTotalRows: 10 }, 11);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/does not match the current total/);
      expect(result.message).toMatch(/Re-run --dry-run/);
    }
  });

  it("accepts a matching total of 0 (the idempotent re-run-on-empty case)", () => {
    const result = checkRealRunGuards({ ...validArgs(), confirmTotalRows: 0 }, 0);
    expect(result.ok).toBe(true);
  });

  it("checks backup-reference before the confirm phrase, so the first-listed gate is reported first", () => {
    const result = checkRealRunGuards(
      { ...validArgs(), backupReference: "", confirm: "wrong phrase" },
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/backup-reference/);
  });

  describe("expectedPhrase parameter (scripts/reset-to-user-and-product.ts)", () => {
    it("defaults to CONFIRM_PHRASE when no third argument is given, so reset-operational-data.ts's existing call site is unaffected", () => {
      const result = checkRealRunGuards(validArgs(), 10);
      expect(result.ok).toBe(true);
    });

    it("rejects CONFIRM_PHRASE when FULL_RESET_CONFIRM_PHRASE is explicitly required", () => {
      const result = checkRealRunGuards({ ...validArgs(), confirm: CONFIRM_PHRASE }, 10, FULL_RESET_CONFIRM_PHRASE);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/--confirm must be exactly/);
        expect(result.message).toMatch(FULL_RESET_CONFIRM_PHRASE);
      }
    });

    it("accepts FULL_RESET_CONFIRM_PHRASE when it is explicitly required and supplied", () => {
      const result = checkRealRunGuards(
        { ...validArgs(), confirm: FULL_RESET_CONFIRM_PHRASE },
        10,
        FULL_RESET_CONFIRM_PHRASE,
      );
      expect(result.ok).toBe(true);
    });

    it("interpolates whichever phrase was expected into the error message, not always CONFIRM_PHRASE", () => {
      const result = checkRealRunGuards({ ...validArgs(), confirm: "wrong" }, 10, FULL_RESET_CONFIRM_PHRASE);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toBe(`--confirm must be exactly: ${FULL_RESET_CONFIRM_PHRASE}`);
      }
    });

    it("confirms the two phrases are distinct strings (guards against an accidental alias)", () => {
      expect(FULL_RESET_CONFIRM_PHRASE).not.toBe(CONFIRM_PHRASE);
    });
  });

  describe("requireBackupReference parameter (scripts/reset-to-user-and-product.ts)", () => {
    it("defaults to true when no fourth argument is given, so reset-operational-data.ts's existing call site is unaffected", () => {
      const args = validArgs();
      delete (args as { backupReference?: string }).backupReference;
      const result = checkRealRunGuards(args, 10);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/backup-reference/);
    });

    it("skips the backup-reference gate entirely when explicitly set to false, even with no backupReference given", () => {
      const args = { ...validArgs(), confirm: FULL_RESET_CONFIRM_PHRASE };
      delete (args as { backupReference?: string }).backupReference;
      const result = checkRealRunGuards(args, 10, FULL_RESET_CONFIRM_PHRASE, false);
      expect(result.ok).toBe(true);
    });

    it("still accepts a supplied backup-reference when the gate is off -- the flag removes the requirement, not the option", () => {
      const result = checkRealRunGuards(
        { ...validArgs(), confirm: FULL_RESET_CONFIRM_PHRASE, backupReference: "snapshot taken anyway" },
        10,
        FULL_RESET_CONFIRM_PHRASE,
        false,
      );
      expect(result.ok).toBe(true);
    });

    it("still enforces the confirm-phrase and fresh-total gates when the backup gate is off", () => {
      const withoutBackup = () => {
        const a = validArgs();
        delete (a as { backupReference?: string }).backupReference;
        return a;
      };
      const wrongPhrase = checkRealRunGuards(
        { ...withoutBackup(), confirm: "wrong" },
        10,
        FULL_RESET_CONFIRM_PHRASE,
        false,
      );
      expect(wrongPhrase.ok).toBe(false);

      const staleTotal = checkRealRunGuards(
        { ...withoutBackup(), confirm: FULL_RESET_CONFIRM_PHRASE, confirmTotalRows: 10 },
        11,
        FULL_RESET_CONFIRM_PHRASE,
        false,
      );
      expect(staleTotal.ok).toBe(false);
    });
  });
});
