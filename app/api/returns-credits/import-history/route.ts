import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listCreditNoteImportBatches } from "@/lib/returns-credits/queries";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function readInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed < min || parsed > max ? fallback : parsed;
}

/**
 * Milestone 6B (Returns & Credit Notes).
 * GET lists past credit-note import batches, mirroring app/api/invoice-
 * reconciliation/import-history/route.ts. Open to any authenticated user
 * -- reading history carries no financial-assertion weight; only writing
 * a credit note (the import confirm route, or manual entry) does.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const page = readInteger(params.get("page"), 1, 1, 100000);
    const pageSize = readInteger(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

    const result = await listCreditNoteImportBatches(page, pageSize);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Credit note import history list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load import history." }, { status: 500 });
  }
}
