import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createUserSchema } from "@/lib/user-validation";
import { createUser, listUsers } from "@/lib/users";

/** GET /api/users -- any authenticated user can see the user directory (matches the existing Settings > Users & Roles screen); only creation/status changes are administrator-only. */
export async function GET() {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const users = await listUsers();
    return NextResponse.json({ success: true, users }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("User list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load users." }, { status: 500 });
  }
}

/**
 * POST /api/users -- administrator-only (re-checked here against the
 * database via requireUserOrResponse, never only via proxy.ts or a hidden
 * UI button). Creates a user with a server-generated temporary password
 * that must be changed at first login; the password is returned once in
 * this response and never stored in recoverable form.
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

    const parsed = createUserSchema.safeParse(body.body);
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

    const result = await createUser(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.message, fieldErrors: result.fieldErrors },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        user: { id: result.id },
        temporaryPassword: result.temporaryPassword,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("User create failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create the user." }, { status: 500 });
  }
}
