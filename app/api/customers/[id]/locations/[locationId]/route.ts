import { NextRequest } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getCustomerById } from "@/lib/customer-queries";
import { validateUpdateLocation } from "@/lib/location-validation";
import { updateLocation } from "@/lib/locations";

type RouteContext = { params: Promise<{ id: string; locationId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const { id, locationId } = await context.params;

    if (!isValidId(id) || !isValidId(locationId)) {
      return Response.json(
        { success: false, message: "Invalid customer or location id." },
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

    const validated = validateUpdateLocation(body.body);

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

    const updated = await updateLocation(id, locationId, validated.value);

    if (!updated.ok) {
      return Response.json(
        { success: false, message: updated.message },
        { status: updated.status }
      );
    }

    const customer = await getCustomerById(id);

    return Response.json(
      { success: true, changed: updated.changed, customer },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Location update failed:", error);

    return Response.json(
      { success: false, message: "Unable to update the location." },
      { status: 500 }
    );
  }
}