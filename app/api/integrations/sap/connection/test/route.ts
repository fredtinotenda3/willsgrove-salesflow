import { NextRequest, NextResponse } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getSapAdapter } from "@/lib/integrations/sap/get-adapter";
import { recordConnectionTestResult } from "@/lib/integrations/sap/connection";

/**
 * Milestone 9 (SAP Business One Integration). POST /api/integrations/
 * sap/connection/test -- an ADMINISTRATOR's explicit "Test connection"
 * click (spec section 6). Goes through getSapAdapter() exactly like
 * every other call in this project -- if the connection is MOCK/
 * disabled, this honestly tests (and reports) the mock adapter, never
 * silently no-ops.
 */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;

  try {
    const adapter = await getSapAdapter();
    const health = await adapter.testConnection();
    await recordConnectionTestResult({ ok: health.ok, message: health.message });
    return NextResponse.json({ success: true, health }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SAP connection test failed unexpectedly:", error);
    return NextResponse.json({ success: false, message: "Unable to test the SAP connection." }, { status: 500 });
  }
}
