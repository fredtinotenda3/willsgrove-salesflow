import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createVehicleSchema } from "@/lib/vehicle-validation";
import { createVehicle, listVehicles } from "@/lib/vehicles";

/**
 * Final Operational Enhancements (spec Part 4). GET /api/vehicles -- any
 * authenticated user can see the Vehicle directory, same convention as
 * /api/personnel (it backs the Dispatch screen's Vehicle dropdown).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get("status");
  const status = rawStatus === "ACTIVE" || rawStatus === "INACTIVE" ? rawStatus : undefined;
  const search = searchParams.get("search")?.trim() || undefined;

  try {
    const vehicles = await listVehicles({ status, search });
    return NextResponse.json({ success: true, vehicles }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Vehicle list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load vehicles." }, { status: 500 });
  }
}

/** POST /api/vehicles -- administrator-only. */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = createVehicleSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return NextResponse.json({ success: false, message: "Validation failed.", fieldErrors }, { status: 400 });
    }

    const result = await createVehicle(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }

    return NextResponse.json({ success: true, id: result.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Vehicle create failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create this vehicle." }, { status: 500 });
  }
}
