import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildManagementPackWorkbook } from "@/lib/reporting/management-pack-xlsx";
import type { ManagementPack } from "@/lib/reporting/management-pack-types";

const pack: ManagementPack = {
  period: { kind: "week", label: "Week 16 Nov - 22 Nov 2026", dateFrom: "2026-11-16", dateTo: "2026-11-22", isComplete: true, priorLabel: "Week 9 Nov - 15 Nov 2026", priorDateFrom: "2026-11-09", priorDateTo: "2026-11-15" },
  generatedAt: "2026-11-24T10:00:00.000Z",
  kpis: [{ id: "ordersReceived", label: "Orders Received", unit: "count", value: "40", previousValue: "30", changePercent: 33.3, polarity: "up-good", definition: "Orders received." }],
  revenue: [{ currency: "USD", value: "1200.5", previousValue: null, changePercent: null, excludedLineCount: 2 }],
  unresolvedClaims: {
    claimLineCount: 3,
    exposure: [{ currency: "USD", value: "75" }, { currency: "ZWG", value: "300" }],
    linesWithoutPrice: 1,
    topReasons: [{ reason: "Damaged", claimLineCount: 2, value: [{ currency: "USD", value: "75" }] }],
    topProducts: [{ name: "Tomatoes", unit: "kg", delivered: "100", deliveredComplete: false, accepted: "60", rejected: "40", returned: "10", value: [{ currency: "USD", value: "75" }] }],
  },
  repeatedShortages: [],
  exceptions: [{ label: "Failed messages", count: 2, severity: "attention" }],
  notes: ["A claim is not a credit note."],
};

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  return wb;
}

describe("buildManagementPackWorkbook", () => {
  it("writes every sheet with the pack's own figures", async () => {
    const wb = await read(await buildManagementPackWorkbook(pack));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Invoiced revenue", "Unresolved claims", "Repeated shortages", "Exceptions", "Notes"]);
    const summary = wb.getWorksheet("Summary")!;
    const kpiRow = summary.getRow(7).values as unknown[];
    expect(kpiRow.slice(1, 5)).toEqual(["Orders Received", "40", "30", "+33.3%"]);
  });
  it("keeps currencies separate, exact, and says so for missing comparisons", async () => {
    const wb = await read(await buildManagementPackWorkbook(pack));
    const rev = wb.getWorksheet("Invoiced revenue")!.getRow(2).values as unknown[];
    expect(rev.slice(1, 5)).toEqual(["USD", "1200.5", "n/a", "n/a"]);
    const claimsText = JSON.stringify(wb.getWorksheet("Unresolved claims")!.getSheetValues());
    expect(claimsText).toContain("USD 75 | ZWG 300");
    expect(claimsText).toContain("(understated)");
  });
  it("renders explicit empty-state rows instead of blank sheets", async () => {
    const wb = await read(await buildManagementPackWorkbook(pack));
    expect(JSON.stringify(wb.getWorksheet("Repeated shortages")!.getSheetValues())).toContain("No product ran short repeatedly");
  });
});
