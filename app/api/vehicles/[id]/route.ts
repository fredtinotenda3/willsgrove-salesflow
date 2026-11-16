import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updateVehicleSchema } from "@/lib/vehicle-validation";
import { deleteVehicle, updateVehicle } from "@/lib/vehicles";

type RouteContext = { params: Promise<{ id: string }> };

/** Final Operational Enhancements (spec Part 4). PATCH /api/vehicles/[id] -- administrator-only. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = updateVehicleSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return NextResponse.json({ success: false, message: "Validation failed.", fieldErrors }, { status: 400 });
    }

    const result = await updateVehicle(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Vehicle update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this vehicle." }, { status: 500 });
  }
}

/** DELETE /api/vehicles/[id] -- administrator-only. "Delete-where-safe", same convention as /api/personnel/[id]. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid vehicle id." }, { status: 400 });
  }

  try {
    const result = await deleteVehicle(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Vehicle delete failed:", error);
    return NextResponse.json({ success: false, message: "Unable to delete this vehicle." }, { status: 500 });
  }
}
