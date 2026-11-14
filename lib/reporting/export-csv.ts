import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 11 (Operational BI). The one shared CSV writer for every
 * M11 export endpoint (spec section 8: "provide export functionality...
 * such as CSV"). No CSV-writing helper existed anywhere in this codebase
 * before this milestone -- the only prior CSV export
 * (app/reports/page.tsx, replaced by this milestone) built its string by
 * hand, client-side, over hardcoded demo data. This is the real,
 * server-side, tested replacement every report route calls into, so the
 * quoting/escaping rule is written and tested exactly once.
 */

/** RFC-4180-style quoting: wrap in double quotes and double any internal double quote. Every field is quoted unconditionally (simpler and still fully correct, rather than only quoting fields that "need" it). */
function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Builds a complete CSV document (header row + one row per record) from
 * plain objects and an explicit, ordered column list -- the column list
 * is required (never `Object.keys(rows[0])`) so a report's column order
 * and header text are a deliberate choice, not whatever order V8 happens
 * to iterate object keys in, and so an export is well-formed even when
 * `rows` is empty.
 */
export function buildCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly { key: keyof T; header: string }[]
): string {
  const headerLine = columns.map((c) => csvField(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvField(row[c.key] as string | number | boolean | null | undefined)).join(","));
  // CRLF line endings -- the CSV convention most spreadsheet tools
  // (including the Windows-native Excel this project's own setup docs
  // target) expect without complaint.
  return [headerLine, ...lines].join("\r\n") + "\r\n";
}

/**
 * Records that a report export happened (spec section 11: "auditability
 * of important report exports"), reusing the existing AuditEvent model --
 * no new model needed. `filters` is the exact, already-validated
 * ReportFilters/pagination the export was run with, so a later question
 * ("who exported the claims exposure report for October, and with which
 * filters") has a real, queryable answer.
 */
export async function recordReportExport(input: {
  actorId: string;
  reportId: string;
  filters: Record<string, unknown>;
  rowCount: number;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: "REPORT_EXPORTED",
      entityType: "Report",
      entityId: input.reportId,
      afterData: toJsonValue({ reportId: input.reportId, filters: input.filters, rowCount: input.rowCount }),
    },
  });
}

/**
 * Converts an arbitrary, assumed-JSON-serializable value (every caller
 * here passes an already-validated ReportFilters-shaped object -- see
 * lib/reporting/types.ts/filters.ts) into the shape Prisma's JSON columns
 * (`Prisma.InputJsonValue`) actually require. A plain `Record<string,
 * unknown>` is not structurally assignable to `InputJsonValue` because
 * `unknown` offers no guarantee the value is JSON-safe (it could hold a
 * function, a `Date`, `undefined`, etc.) -- and several callers' filter
 * objects do include `Date` values (e.g. report dateFrom/dateTo), which
 * are not valid Prisma JSON input on their own either. Round-tripping
 * through real `JSON.stringify`/`JSON.parse` is the correct, type-safe
 * conversion for "this is going into a JSON column": it applies the same
 * serialization a `Date` would get via its own `toJSON()`, drops
 * `undefined` keys, and the *result* is provably JSON-shaped -- this is
 * not a bare type-assertion papering over a real mismatch, it is the
 * actual transformation Prisma's own JSON columns apply to any object at
 * the database boundary, made explicit and done once, here, rather than
 * at each of this function's many callers.
 */
function toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Flattens a nested summary/dashboard object (numbers, strings, nulls,
 * and nested objects of the same) into flat "metric","value" rows for a
 * CSV export -- used for the summary-shaped reports (sales-pipeline,
 * fulfilment-intelligence, financial-exposure, communications-
 * monitoring, and the summary-kind management reports), which are
 * naturally a tree of named figures rather than a list of records.
 * Arrays are rendered as a JSON string in a single cell rather than
 * silently dropped -- a CSV is still the right export format for "a
 * handful of named figures," it just can't give an array its own rows
 * without a dedicated column layout, which each such array already gets
 * from its own, purpose-built export route where one exists.
 */
export function flattenToKeyValueRows(value: unknown, pathPrefix = ""): { metric: string; value: string }[] {
  if (value === null || value === undefined) {
    return [{ metric: pathPrefix || "value", value: "" }];
  }
  if (Array.isArray(value)) {
    return [{ metric: pathPrefix || "value", value: JSON.stringify(value) }];
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flattenToKeyValueRows(child, pathPrefix ? `${pathPrefix}.${key}` : key));
  }
  return [{ metric: pathPrefix || "value", value: String(value) }];
}

export function csvResponseHeaders(filenameStem: string): HeadersInit {
  const today = new Date().toISOString().slice(0, 10);
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filenameStem}-${today}.csv"`,
    "Cache-Control": "no-store",
  };
}
