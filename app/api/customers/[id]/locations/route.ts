import { NextRequest } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { getCustomerById } from "@/lib/customer-queries";
import { validateCreateLocation } from "@/lib/location-validation";
import { createLocation } from "@/lib/locations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
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

    const validated = validateCreateLocation(body.body);

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

    const created = await createLocation(id, validated.value);

    if (!created.ok) {
      return Response.json(
        { success: false, message: created.message },
        { status: created.status }
      );
    }

    const customer = await getCustomerById(id);

    return Response.json(
      { success: true, locationId: created.id, customer },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Location create failed:", error);

    return Response.json(
      { success: false, message: "Unable to add the location." },
      { status: 500 }
    );
  }
}