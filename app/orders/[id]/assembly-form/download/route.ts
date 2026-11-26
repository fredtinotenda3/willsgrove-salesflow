import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getOrderById } from "@/lib/order-queries";
import { formatOrderDate } from "@/lib/order-display";
import { resolveAssemblyFormLine } from "@/lib/assembly-form/resolve-line";
import { buildAssemblyFormPdf } from "@/lib/assembly-form/pdf";
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_TAGLINE } from "@/lib/company-info";

const NOT_ASSEMBLABLE_STATUSES = new Set(["CANCELLED", "REJECTED"]);

/**
 * GET /orders/[id]/assembly-form/download -- the Warehouse Assembly Form as a PDF file.
 *
 * Same guards and the same read-only data as the printable page beside it (authenticated user, valid
 * id, not cancelled/rejected, at least one line); performs no writes. Found/Unavailable stay blank.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  const order = await getOrderById(id);
  if (!order || NOT_ASSEMBLABLE_STATUSES.has(order.status) || order.lines.length === 0) {
    return NextResponse.json({ success: false, message: "No assembly form is available for this order." }, { status: 404 });
  }

  const lines = order.lines.map((line) => resolveAssemblyFormLine(line));
  const pdf = buildAssemblyFormPdf({
    companyName: COMPANY_NAME,
    companyAddress: COMPANY_ADDRESS,
    companyTagline: COMPANY_TAGLINE,
    customerName: order.customer?.name ?? "Unknown customer",
    customerPoReference: order.customerPoReference ?? null,
    orderReference: order.reference,
    orderDate: formatOrderDate(order.orderDate),
    lines: lines.map((line) => ({
      lineNumber: line.lineNumber,
      sapItemCode: line.sapItemCode,
      description: line.description,
      requestedQuantity: String(line.requestedQuantity),
      requestedUnitCode: String(line.requestedUnitCode),
    })),
  });

  const safeReference = order.reference.replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Assembly-Form-${safeReference}.pdf"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
