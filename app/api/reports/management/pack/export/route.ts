import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { recordReportExport } from "@/lib/reporting/export-csv";
import { getManagementPack } from "@/lib/reporting/management-pack";
import { isPackPeriodKind, resolvePackPeriod } from "@/lib/reporting/management-pack-period";
import { buildManagementPackWorkbook } from "@/lib/reporting/management-pack-xlsx";

/**
 * GET /api/reports/management/pack/export?kind=week|month&anchor=YYYY-MM-DD
 * Excel export of the weekly/monthly management pack. Same gate as every
 * management report (SALES_MANAGER / ADMINISTRATOR), enforced here on the
 * server; the export is audited like the CSV exports. Read-only, so no CSRF
 * check applies (GET). PDF is produced from the print layout of the pack page.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const kind = request.nextUrl.searchParams.get("kind");
  if (!isPackPeriodKind(kind)) {
    return NextResponse.json({ success: false, message: "kind must be 'week' or 'month'." }, { status: 400 });
  }
  const period = resolvePackPeriod(kind, request.nextUrl.searchParams.get("anchor"));

  try {
    const pack = await getManagementPack(auth.user.id, auth.user.role, period);
    const buffer = await buildManagementPackWorkbook(pack);
    await recordReportExport({ actorId: auth.user.id, reportId: `management-pack-${kind}`, filters: { kind, dateFrom: period.dateFrom, dateTo: period.dateTo, format: "xlsx" }, rowCount: pack.kpis.length + pack.revenue.length });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="management-pack-${kind}-${period.dateFrom}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Management pack export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the management pack." }, { status: 500 });
  }
}
