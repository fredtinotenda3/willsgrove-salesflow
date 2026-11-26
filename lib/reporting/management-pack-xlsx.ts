import ExcelJS from "exceljs";
import type { ManagementPack, PackMoneyRow } from "@/lib/reporting/management-pack-types";
import { formatCurrencyAmount } from "@/lib/format/currency";

/**
 * Builds the management-pack workbook from an already-assembled pack. No
 * database access, so it is unit-testable and cannot show anything the page
 * does not. Money and quantity cells are written as TEXT of the exact
 * decimal string (never a float) with the currency alongside, so a figure
 * the reconciliation layer holds exactly is not rounded by Excel; the
 * trade-off is that those cells do not sum in Excel, which is deliberate:
 * currencies must never be added together.
 */

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17251E" } };

function header(sheet: ExcelJS.Worksheet, titles: string[]) {
  const row = sheet.addRow(titles);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", wrapText: true };
}

function money(rows: PackMoneyRow[]): string {
  return rows.length === 0 ? "None" : rows.map((r) => formatCurrencyAmount(r.currency, r.value)).join(" | ");
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function widths(sheet: ExcelJS.Worksheet, cols: number[]) {
  cols.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

export async function buildManagementPackWorkbook(pack: ManagementPack): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Willsgrove SalesFlow";
  wb.created = new Date(pack.generatedAt);

  const summary = wb.addWorksheet("Summary");
  summary.addRow([`Management pack - ${pack.period.label}`]).font = { bold: true, size: 14 };
  summary.addRow([`Period ${pack.period.dateFrom} to ${pack.period.dateTo}${pack.period.isComplete ? "" : " (period still running: figures are to date)"}`]);
  summary.addRow([`Compared with ${pack.period.priorLabel} (${pack.period.priorDateFrom} to ${pack.period.priorDateTo})`]);
  summary.addRow([`Generated ${pack.generatedAt}`]);
  summary.addRow([]);
  header(summary, ["Measure", "This period", "Previous period", "Change", "Definition"]);
  for (const kpi of pack.kpis) summary.addRow([kpi.label, kpi.value, kpi.previousValue ?? "n/a", pct(kpi.changePercent), kpi.definition]);
  widths(summary, [34, 22, 22, 12, 80]);

  const revenue = wb.addWorksheet("Invoiced revenue");
  header(revenue, ["Currency", "This period", "Previous period", "Change", "Lines excluded (no total)"]);
  for (const row of pack.revenue) revenue.addRow([row.currency, row.value, row.previousValue ?? "n/a", pct(row.changePercent), row.excludedLineCount]);
  if (pack.revenue.length === 0) revenue.addRow(["No invoiced revenue in this period."]);
  revenue.addRow([]);
  revenue.addRow(["Revenue is the sum of SAP invoice line values, per currency. Currencies are never added together."]);
  widths(revenue, [14, 22, 22, 12, 28]);

  const claims = wb.addWorksheet("Unresolved claims");
  claims.addRow(["Unresolved claims (as at generation time, not limited to the period)"]).font = { bold: true };
  claims.addRow(["Claim lines", pack.unresolvedClaims.claimLineCount]);
  claims.addRow(["Disputed value (invoice prices)", money(pack.unresolvedClaims.exposure)]);
  claims.addRow(["Lines without a price (excluded from value)", pack.unresolvedClaims.linesWithoutPrice]);
  claims.addRow(["A claim is a customer dispute, not a SAP credit note. This is value in dispute, not value credited."]);
  claims.addRow([]);
  header(claims, ["Rejected product", "Unit", "Delivered", "Accepted", "Rejected", "Returned", "Claim value"]);
  for (const p of pack.unresolvedClaims.topProducts) {
    claims.addRow([p.name, p.unit ?? "mixed", p.deliveredComplete ? p.delivered : `${p.delivered} (understated)`, p.accepted, p.rejected, p.returned, money(p.value)]);
  }
  claims.addRow([]);
  header(claims, ["Reason", "Claim lines", "Claim value"]);
  for (const r of pack.unresolvedClaims.topReasons) claims.addRow([r.reason, r.claimLineCount, money(r.value)]);
  widths(claims, [40, 14, 24, 14, 14, 14, 32]);

  const shortages = wb.addWorksheet("Repeated shortages");
  header(shortages, ["Product", "Item code", "Orders short", "Quantity unavailable", "Unit"]);
  for (const s of pack.repeatedShortages) shortages.addRow([s.name, s.sapItemCode ?? "", s.demandCount, s.unavailableQuantity, s.unit ?? ""]);
  if (pack.repeatedShortages.length === 0) shortages.addRow(["No product ran short repeatedly in this period."]);
  widths(shortages, [40, 16, 14, 22, 10]);

  const exceptions = wb.addWorksheet("Exceptions");
  header(exceptions, ["Item", "Count", "Severity"]);
  for (const e of pack.exceptions) exceptions.addRow([e.label, e.count, e.severity]);
  if (pack.exceptions.length === 0) exceptions.addRow(["No open exceptions."]);
  widths(exceptions, [48, 10, 12]);

  const notes = wb.addWorksheet("Notes");
  for (const note of pack.notes) notes.addRow([note]);
  notes.getColumn(1).width = 120;
  notes.getColumn(1).alignment = { wrapText: true, vertical: "top" };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
