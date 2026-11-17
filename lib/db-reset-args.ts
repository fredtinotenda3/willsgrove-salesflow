/**
 * Pure argument-parsing and confirmation-guard logic for
 * scripts/reset-operational-data.ts, split out into its own module so the
 * safety gates (confirm phrase, backup-reference presence, the fresh-total
 * row-count match) have real unit coverage without needing a database --
 * matching this project's established pure/impure module split (the
 * database-touching parts -- validating the actor against the User table,
 * counting rows, running the transaction -- stay in the script itself).
 */

export const CONFIRM_PHRASE = "RESET OPERATIONAL DATA FOR WILLSGROVE SALESFLOW";

export interface ParsedResetArgs {
  actor?: string;
  dryRun: boolean;
  backupReference?: string;
  confirm?: string;
  confirmTotalRows?: number;
}

export function parseResetArgs(argv: string[]): ParsedResetArgs {
  const result: ParsedResetArgs = { dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    // No /s (dotAll) flag needed: argv entries are single strings with no
    // embedded newlines, so plain "." already matches every character a
    // --key=value argument can contain. Also avoids requiring an es2018+
    // compile target this project's tsconfig doesn't set.
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(raw);
    if (!match) continue;
    const [, key, value] = match;
    switch (key) {
      case "actor":
        result.actor = value;
        break;
      case "backup-reference":
        result.backupReference = value;
        break;
      case "confirm":
        result.confirm = value;
        break;
      case "confirm-total-rows":
        result.confirmTotalRows = /^\d+$/.test(value) ? Number(value) : NaN;
        break;
    }
  }
  return result;
}

export function totalOfCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

export type RealRunGuardResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Validates the four real-run-only gates (everything beyond --actor, which
 * the script itself checks against the database): a non-empty
 * --backup-reference, an exact --confirm phrase match, a well-formed
 * --confirm-total-rows, and that it matches a freshly re-counted total
 * taken at run time -- never the dry run's own cached number, so a stale
 * or copy-pasted command from an earlier moment or a different environment
 * is refused rather than silently deleting a different amount of data than
 * the operator actually reviewed.
 */
export function checkRealRunGuards(args: ParsedResetArgs, freshTotal: number): RealRunGuardResult {
  if (!args.backupReference || args.backupReference.trim().length === 0) {
    return {
      ok: false,
      message:
        '--backup-reference="<description of what backup was taken and when>" is required and must be non-empty.',
    };
  }
  if (args.confirm !== CONFIRM_PHRASE) {
    return { ok: false, message: `--confirm must be exactly: ${CONFIRM_PHRASE}` };
  }
  if (args.confirmTotalRows === undefined || Number.isNaN(args.confirmTotalRows)) {
    return { ok: false, message: "--confirm-total-rows=<N> is required and must be a non-negative integer." };
  }
  if (args.confirmTotalRows !== freshTotal) {
    return {
      ok: false,
      message:
        `--confirm-total-rows=${args.confirmTotalRows} does not match the current total of ${freshTotal}. ` +
        "Data has changed since you last ran --dry-run (or this command was copied from a different moment " +
        "or environment). Re-run --dry-run and confirm the new total before proceeding.",
    };
  }
  return { ok: true };
}
