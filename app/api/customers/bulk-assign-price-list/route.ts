import { NextRequest } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseBulkAssignPriceListInput } from "@/lib/customer-queries";
import { bulkAssignPriceList } from "@/lib/customers";

/**
 * Real-world fix (bulk price-list assignment). See
 * lib/customers.ts's bulkAssignPriceList for why this exists at all --
 * the real customer-master export has no price-list column, so
 * app/price-lists/customers/page.tsx's existing one-row-at-a-time
 * assignPriceList() is not a realistic way to work through ~2,647
 * customers. This is the bulk counterpart: assign every customer
 * currently matching a filter (search/category/status/priceListId --
 * the exact same filter semantics as GET /api/customers) to one target
 * price list in a single request.
 *
 * Gated to SALES_MANAGER/ADMINISTRATOR, same as
 * /api/customers/master-import -- a bulk pricing change across
 * potentially thousands of customers is closer in blast radius to a
 * master-data import than to a single customer edit (which stays open
 * to any authenticated user, unchanged).
 */
export async function PATCH(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;

  try {
    const body = await readJsonObject(request);

    if (!body.ok) {
      return Response.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = parseBulkAssignPriceListInput(body.body);

    if (!parsed.ok) {
      return Response.json({ success: false, message: parsed.message }, { status: 400 });
    }

    const result = await bulkAssignPriceList(
      parsed.input.filter,
      parsed.input.targetPriceListId,
      parsed.input.confirmedUnfiltered
    );

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message, fieldErrors: result.fieldErrors },
        { status: result.status }
      );
    }

    return Response.json({ success: true, matchedCount: result.matchedCount });
  } catch (error) {
    console.error("Bulk customer price-list assignment failed:", error);

    return Response.json(
      { success: false, message: "Unable to assign the price list to these customers." },
      { status: 500 }
    );
  }
}
