import { NextRequest } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { getCustomerById } from "@/lib/customer-queries";
import { validateUpdateCustomer } from "@/lib/customer-validation";
import { updateCustomer } from "@/lib/customers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!isValidId(id)) {
      return Response.json(
        { success: false, message: "Invalid customer id." },
        { status: 400 }
      );
    }

    const customer = await getCustomerById(id);

    if (!customer) {
      return Response.json(
        { success: false, message: "Customer not found." },
        { status: 404 }
      );
    }

    return Response.json(
      { success: true, customer },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Customer load failed:", error);

    return Response.json(
      { success: false, message: "Unable to load the customer." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!isValidId(id)) {
      return Response.json(
        { success: false, message: "Invalid customer id." },
        { status: 400 }
      );
    }

    const body = await readJsonObject(request);

    if (!body.ok) {
      return Response.json(
        { success: false, message: body.message },
        { status: 400 }
      );
    }

    const validated = validateUpdateCustomer(body.body);

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

    const updated = await updateCustomer(id, validated.value);

    if (!updated.ok) {
      return Response.json(
        {
          success: false,
          message: updated.message,
          fieldErrors: updated.fieldErrors,
        },
        { status: updated.status }
      );
    }

    const customer = await getCustomerById(id);

    return Response.json(
      { success: true, changed: updated.changed, customer },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Customer update failed:", error);

    return Response.json(
      { success: false, message: "Unable to update the customer." },
      { status: 500 }
    );
  }
}