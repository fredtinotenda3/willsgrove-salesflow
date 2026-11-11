import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listCreditNotes } from "@/lib/returns-credits/queries";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function readInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed < min || parsed > max ? fallback : parsed;
}

/**
 * Milestone 6B (Returns & Credit Notes).
 * GET lists credit notes, primarily the reconciliation queue
 * (?matchStatus=UNMATCHED or CANNOT_LINK) -- same role Milestone 5's own
 * unmatched-invoice-lines list plays. Open to any authenticated user;
 * only the manual-match/cannot-link/reopen actions below are
 * SALES_MANAGER/ADMINISTRATOR-gated.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const page = readInteger(params.get("page"), 1, 1, 100000);
    const pageSize = readInteger(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

    const result = await listCreditNotes(
      {
        matchStatus: params.get("matchStatus") ?? undefined,
        claimId: params.get("claimId") ?? undefined,
        sapInvoiceId: params.get("sapInvoiceId") ?? undefined,
        search: params.get("search") ?? undefined,
      },
      page,
      pageSize
    );
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Credit note list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load credit notes." }, { status: 500 });
  }
}
