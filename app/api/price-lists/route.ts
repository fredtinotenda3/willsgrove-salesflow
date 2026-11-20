import { NextRequest } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createPriceList, getPriceListStats, listPriceLists } from "@/lib/price-list-queries";

/**
 * Real Business Data Onboarding round (spec PART A, Phase 4b). Plain list
 * of every PriceList -- backs the Customer Pricing page's assignment
 * dropdown and filter. No pagination (see lib/price-list-queries.ts).
 *
 * Follow-up fix ("Price should also have its own page too with its stats
 * card and other necessary info"): also returns `stats`, for the new
 * /price-lists landing page's stat cards. Additive -- the existing
 * `priceLists` shape and its two existing consumers (the Customer
 * Pricing page, this route's own prior callers) are unchanged.
 */
export async function GET() {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const [priceLists, stats] = await Promise.all([listPriceLists(), getPriceListStats()]);

    return Response.json(
      { success: true, priceLists, stats },
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

/**
 * Follow-up fix ("price page should also have button to add... like
 * customer and products pages") -- creates a single PriceList by hand.
 * Same shape/division of labor as app/api/customers/route.ts's own POST.
 */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return Response.json({ success: false, message: body.message }, { status: 400 });
    }

    const { code, name, currencyCode } = body.body;
    if (typeof code !== "string" || typeof name !== "string" || typeof currencyCode !== "string") {
      return Response.json(
        {
          success: false,
          message: "Validation failed.",
          fieldErrors: {
            ...(typeof code !== "string" ? { code: "Code is required." } : {}),
            ...(typeof name !== "string" ? { name: "Name is required." } : {}),
            ...(typeof currencyCode !== "string" ? { currencyCode: "Currency is required." } : {}),
          },
        },
        { status: 400 }
      );
    }

    const created = await createPriceList({ code, name, currencyCode }, auth.user.id);

    if (!created.ok) {
      return Response.json(
        { success: false, message: created.message, fieldErrors: created.fieldErrors },
        { status: created.status }
      );
    }

    return Response.json(
      { success: true, id: created.id },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Price list create failed:", error);

    return Response.json(
      { success: false, message: "Unable to create the price list." },
      { status: 500 }
    );
  }
}
