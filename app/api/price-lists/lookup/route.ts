import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { resolveCustomerPriceListUnitPrice } from "@/lib/price-list-queries";
import { isValidId } from "@/lib/http";

/**
 * Real Business Data Onboarding round, follow-up fix: backs the
 * quotation-line product picker's price-prefill (see
 * app/quotations/new/new-quotation-form.tsx's selectProduct). Same
 * no-role-gate convention as app/api/price-lists/route.ts and quotation
 * creation itself (any authenticated user) -- this is a read-only
 * lookup, not a mutation.
 *
 * Returns { success: true, price: null } (never a 404/error) when the
 * customer has no price list assigned or no matching entry exists --
 * "no price found" is an expected, routine outcome here, not a failure;
 * the caller leaves the price field blank for the operator, same as
 * before this endpoint existed.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const customerId = request.nextUrl.searchParams.get("customerId");
  const productId = request.nextUrl.searchParams.get("productId");

  if (!customerId || !isValidId(customerId) || !productId || !isValidId(productId)) {
    return Response.json({ success: false, message: "customerId and productId are required." }, { status: 400 });
  }

  try {
    const price = await resolveCustomerPriceListUnitPrice(customerId, productId);
    return Response.json({ success: true, price }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Price-list price lookup failed:", error);
    return Response.json({ success: false, message: "Unable to look up a price." }, { status: 500 });
  }
}
