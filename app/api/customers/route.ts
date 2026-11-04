import { NextRequest } from "next/server";
import { readJsonObject } from "@/lib/http";
import {
  getCustomerById,
  listCustomers,
  parseCustomerListQuery,
} from "@/lib/customer-queries";
import { validateCreateCustomer } from "@/lib/customer-validation";
import { createCustomer } from "@/lib/customers";

export async function GET(request: NextRequest) {
  try {
    const parsed = parseCustomerListQuery(request.nextUrl.searchParams);

    if (!parsed.ok) {
      return Response.json(
        { success: false, message: parsed.message },
        { status: 400 }
      );
    }

    const result = await listCustomers(parsed.query);

    return Response.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Customer list failed:", error);

    return Response.json(
      { success: false, message: "Unable to load customers." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);

    if (!body.ok) {
      return Response.json(
        { success: false, message: body.message },
        { status: 400 }
      );
    }

    const validated = validateCreateCustomer(body.body);

    if (!validated.ok) {
      return Response.json(
        {
          success: false,
          message: "Validation failed.",
          fieldErrors: validated.fieldErrors,
        },
        { status: 400 }
      );
    }

    const created = await createCustomer(validated.value);

    if (!created.ok) {
      return Response.json(
        {
          success: false,
          message: created.message,
          fieldErrors: created.fieldErrors,
        },
        { status: created.status }
      );
    }

    const customer = await getCustomerById(created.id);

    return Response.json(
      { success: true, customer },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Customer create failed:", error);

    return Response.json(
      { success: false, message: "Unable to create the customer." },
      { status: 500 }
    );
  }
}