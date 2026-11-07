import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listOrders, parseOrderListQuery } from "@/lib/order-queries";
import { createOrderSchema } from "@/lib/order-validation";
import { createOrderAndReturn } from "@/lib/orders";

export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const parsed = parseOrderListQuery(request.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
    }

    const result = await listOrders(parsed.query);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Order list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load orders." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = createOrderSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return NextResponse.json(
        { success: false, message: "Validation failed.", fieldErrors },
        { status: 400 }
      );
    }

    const result = await createOrderAndReturn(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.message, fieldErrors: result.fieldErrors },
        { status: result.status }
      );
    }

    return NextResponse.json(
      { success: true, order: result.order, idempotentReplay: result.idempotentReplay },
      { status: result.idempotentReplay ? 200 : 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Order create failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create the order." }, { status: 500 });
  }
}
