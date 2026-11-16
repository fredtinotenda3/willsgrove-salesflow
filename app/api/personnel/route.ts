import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createPersonnelSchema } from "@/lib/personnel-validation";
import { createPersonnel, listPersonnel } from "@/lib/personnel";

/**
 * Final Operational Enhancements (spec Part 4). GET /api/personnel --
 * any authenticated user can see the Personnel directory (the same
 * "directory is readable by anyone, only mutations are admin-only"
 * convention app/api/users/route.ts already uses) -- this list also
 * backs the Driver/Driver's Assistant dropdowns on the Dispatch screen
 * (spec Part 3.3), which any authenticated user can reach, so the
 * directory itself must be readable by any authenticated user too.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const rawRole = searchParams.get("role");
  const role = rawRole === "DRIVER" || rawRole === "DRIVER_ASSISTANT" || rawRole === "OTHER" ? rawRole : undefined;
  const rawStatus = searchParams.get("status");
  const status = rawStatus === "ACTIVE" || rawStatus === "INACTIVE" ? rawStatus : undefined;
  const search = searchParams.get("search")?.trim() || undefined;

  try {
    const personnel = await listPersonnel({ role, status, search });
    return NextResponse.json({ success: true, personnel }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Personnel list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load personnel." }, { status: 500 });
  }
}

/**
 * POST /api/personnel -- administrator-only (re-checked here against the
 * database via requireUserOrResponse, never only via proxy.ts or a
 * hidden UI button, same convention as app/api/users/route.ts).
 */
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

    const parsed = createPersonnelSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return NextResponse.json({ success: false, message: "Validation failed.", fieldErrors }, { status: 400 });
    }

    const result = await createPersonnel(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }

    return NextResponse.json({ success: true, id: result.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Personnel create failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create this personnel record." }, { status: 500 });
  }
}
