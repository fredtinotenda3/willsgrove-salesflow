import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listPriceLists } from "@/lib/price-list-queries";

/**
 * Real Business Data Onboarding round (spec PART A, Phase 4b). Plain list
 * of every PriceList -- backs the Customer Pricing page's assignment
 * dropdown and filter. No pagination (see lib/price-list-queries.ts).
 */
export async function GET() {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const priceLists = await listPriceLists();

    return Response.json(
      { success: true, priceLists },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Price list list failed:", error);

    return Response.json(
      { success: false, message: "Unable to load price lists." },
      { status: 500 }
    );
  }
}
