import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listImportBatches } from "@/lib/invoice-reconciliation/queries";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function readInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed < min || parsed > max ? fallback : parsed;
}

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * GET lists past import batches (spec section 10.A's "View import
 * history").
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const page = readInteger(params.get("page"), 1, 1, 100000);
    const pageSize = readInteger(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const includeDemo = params.get("includeDemo") === "true";

    const result = await listImportBatches({ page, pageSize, includeDemo });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Import history list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load import history." }, { status: 500 });
  }
}
