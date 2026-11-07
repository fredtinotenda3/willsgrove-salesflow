import { NextRequest } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import {
  listProducts,
  parseProductListQuery,
} from "@/lib/product-queries";

export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const parsed = parseProductListQuery(request.nextUrl.searchParams);

    if (!parsed.ok) {
      return Response.json(
        { success: false, message: parsed.message },
        { status: 400 }
      );
    }

    const result = await listProducts(parsed.query);

    return Response.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Product list failed:", error);

    return Response.json(
      { success: false, message: "Unable to load products." },
      { status: 500 }
    );
  }
}