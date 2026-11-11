import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getOrCreateConnection, updateConnection } from "@/lib/integrations/sap/connection";
import { updateSapConnectionSchema } from "@/lib/integrations/sap/validation";

/**
 * Milestone 9 (SAP Business One Integration). GET/PATCH the (single,
 * singleton-per-provider) SAP connection configuration -- spec section
 * 6: admin-only configuration, audited, no secret ever in a response
 * body (the password is never read here at all -- see
 * lib/integrations/sap/config.ts).
 */

export async function GET() {
  const auth = await requireUserOrResponse(["ADMINISTRATOR", "SALES_MANAGER"]);
  if (!auth.ok) return auth.response;

  const connection = await getOrCreateConnection();
  return NextResponse.json({ success: true, connection }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = updateSapConnectionSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid request body.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const connection = await updateConnection(parsed.data, user.id);
    return NextResponse.json({ success: true, connection }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to update SAP connection:", error);
    return NextResponse.json({ success: false, message: "Unable to update the SAP connection." }, { status: 500 });
  }
}
