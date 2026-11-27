/**
 * POST /api/orders/parse-po
 *
 * Reads a pasted message and/or one attached file and returns what the
 * New Order form needs to pre-fill itself: the customer (matched, ambiguous
 * or not found) and order lines (matched to catalogue products where
 * clear). READ-ONLY: it creates nothing; the user still reviews and submits
 * through the normal order creation endpoint.
 */
import type { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { analysePo } from "@/lib/po-parse/analyse";
import { resolveCustomer, resolveLines } from "@/lib/po-parse/resolve";

export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 100_000;

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) return Response.json({ success: false, message: csrf.message }, { status: 403 });

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ success: false, message: "Expected multipart form data." }, { status: 400 });
  }

  const textRaw = formData.get("text");
  const text = typeof textRaw === "string" ? textRaw.slice(0, MAX_TEXT) : "";
  const fileRaw = formData.get("file");
  const forcedCustomerId = formData.get("customerId");

  let file: { buffer: Buffer; name: string; claimedMime: string } | undefined;
  if (fileRaw instanceof File && fileRaw.size > 0) {
    if (fileRaw.size > MAX_BYTES) return Response.json({ success: false, message: "File exceeds the 20 MB limit." }, { status: 413 });
    file = { buffer: Buffer.from(await fileRaw.arrayBuffer()), name: fileRaw.name || "upload", claimedMime: fileRaw.type || "application/octet-stream" };
  }

  try {
    const analysed = await analysePo({ text, file });
    if (!analysed.ok) {
      return Response.json({ success: false, code: analysed.code, message: analysed.message }, { status: analysed.code === "NEEDS_VISION_KEY" ? 422 : 200 });
    }

    const { output } = analysed;
    const customer = typeof forcedCustomerId === "string" && forcedCustomerId !== "" ? null : await resolveCustomer(output.header);
    const customerId = typeof forcedCustomerId === "string" && forcedCustomerId !== "" ? forcedCustomerId : customer?.status === "matched" ? customer.customer.id : null;
    const lines = await resolveLines(output.lines, customerId);

    return Response.json(
      {
        success: true,
        source: analysed.source,
        mode: output.mode,
        notes: output.notes,
        header: {
          poNumber: output.header.poNumber,
          orderDate: output.header.orderDate,
          requestedDeliveryDate: output.header.requestedDeliveryDate,
          deliveryAddress: output.header.deliveryAddress,
          currency: output.header.currency,
          customerNameCandidates: output.header.customerNameCandidates,
        },
        customer,
        lines: lines.map((l) => ({
          lineNumber: l.lineNumber,
          rawText: l.rawText,
          description: l.description,
          quantity: l.finalQuantity,
          unit: l.finalUnit,
          packSize: l.packSize,
          unitPrice: l.unitPrice,
          customerItemCode: l.customerItemCode,
          confidence: l.confidence,
          warnings: l.warnings,
          matched: l.matched,
          matchSource: l.matchSource,
          suggestions: l.suggestions,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("parse-po failed:", error);
    return Response.json({ success: false, message: "The order could not be analysed. Please try again or enter the lines manually." }, { status: 500 });
  }
}
