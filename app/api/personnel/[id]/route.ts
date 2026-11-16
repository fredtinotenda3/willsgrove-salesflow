import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updatePersonnelSchema } from "@/lib/personnel-validation";
import { deletePersonnel, updatePersonnel } from "@/lib/personnel";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Final Operational Enhancements (spec Part 4). PATCH /api/personnel/[id]
 * -- administrator-only (edit fields and/or activate/deactivate).
 */
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
    return NextResponse.json({ success: false, message: "Invalid personnel id." }, { status: 400 });
  }

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = updatePersonnelSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return NextResponse.json({ success: false, message: "Validation failed.", fieldErrors }, { status: 400 });
    }

    const result = await updatePersonnel(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Personnel update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this personnel record." }, { status: 500 });
  }
}

/**
 * DELETE /api/personnel/[id] -- administrator-only. "Delete-where-safe":
 * refused with a clear message (409) when this record has dispatch
 * history, via the database's own onDelete: Restrict constraint -- see
 * lib/personnel.ts's deletePersonnel() for why no separate pre-check is
 * needed. The caller should offer deactivating (PATCH status:
 * "INACTIVE") instead when this happens.
 */
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
    return NextResponse.json({ success: false, message: "Invalid personnel id." }, { status: 400 });
  }

  try {
    const result = await deletePersonnel(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Personnel delete failed:", error);
    return NextResponse.json({ success: false, message: "Unable to delete this personnel record." }, { status: 500 });
  }
}
