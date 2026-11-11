import { NextRequest, NextResponse } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { isValidSyncJobSlug, sinceQuerySchema } from "@/lib/integrations/sap/validation";
import { runProductSync } from "@/lib/integrations/sap/product-sync";
import { runCustomerSync } from "@/lib/integrations/sap/customer-sync";
import { runInvoiceSync } from "@/lib/integrations/sap/invoice-sync";
import { runCreditNoteSync } from "@/lib/integrations/sap/credit-note-sync";

type RouteContext = { params: Promise<{ jobType: string }> };

/**
 * Milestone 9 (SAP Business One Integration). POST /api/integrations/
 * sap/sync/{products|customers|invoices|credit-notes} -- an
 * ADMINISTRATOR's manual "Sync now" action (spec section 6/7). Always
 * trigger: "MANUAL" with this request's user as triggeredById; the
 * scheduled equivalent is scripts/sap-sync.ts, run by an external
 * scheduler, never this route.
 *
 * invoices/credit-notes require this ADMINISTRATOR's own id as the
 * underlying SapInvoiceImportBatch/CreditNoteImportBatch's uploadedById
 * (both required, non-nullable columns from Milestone 5/6B -- see
 * lib/integrations/sap/invoice-sync.ts's module comment for why that
 * makes these two manual-only, with no scheduled equivalent at all).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { jobType } = await context.params;
  if (!isValidSyncJobSlug(jobType)) {
    return NextResponse.json({ success: false, message: "Unknown sync job type." }, { status: 400 });
  }

  const sinceParam = request.nextUrl.searchParams.get("since") ?? undefined;
  const parsedSince = sinceQuerySchema.safeParse({ since: sinceParam });
  if (!parsedSince.success) {
    return NextResponse.json({ success: false, message: "Invalid 'since' query parameter." }, { status: 400 });
  }
  const since = parsedSince.data.since ? new Date(parsedSince.data.since) : undefined;

  try {
    const job =
      jobType === "products"
        ? await runProductSync("MANUAL", user.id)
        : jobType === "customers"
          ? await runCustomerSync("MANUAL", user.id)
          : jobType === "invoices"
            ? await runInvoiceSync(user.id, since)
            : await runCreditNoteSync(user.id, since);

    return NextResponse.json({ success: true, job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`SAP ${jobType} sync failed unexpectedly:`, error);
    return NextResponse.json({ success: false, message: "Unable to run this sync." }, { status: 500 });
  }
}
