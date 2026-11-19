import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getPriceListById, listPriceListEntries } from "@/lib/price-list-queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Follow-up fix: "the ability to change or update prices." Backs the new
 * /price-lists/[id] page -- the price list's own detail + a searchable,
 * paginated view of its entries, the first time this codebase has ever
 * surfaced an entry outside the bulk import preview.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid price list id." }, { status: 400 });
  }

  const priceList = await getPriceListById(id);
  if (!priceList) {
    return NextResponse.json({ success: false, message: "Price list not found." }, { status: 404 });
  }

  const search = request.nextUrl.searchParams.get("search");
  const pageParam = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  try {
    const result = await listPriceListEntries(id, { search, page });
    return NextResponse.json(
      { success: true, priceList, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Price-list entries list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load price-list entries." }, { status: 500 });
  }
}
