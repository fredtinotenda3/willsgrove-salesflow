import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { uploadClaimAttachment, MAX_CLAIM_ATTACHMENT_BYTES } from "@/lib/invoice-claims/attachments";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6A. POST uploads a piece of supporting evidence (spec
 * section 2/6) against a claim, or optionally against one specific
 * claim line. Same multipart/form-data convention as
 * app/api/orders/[id]/documents/route.ts.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid claim id." }, { status: 400 });
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_CLAIM_ATTACHMENT_BYTES) {
    return NextResponse.json({ success: false, message: "File exceeds the 20 MB upload limit." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, message: "Missing 'file' field." }, { status: 400 });
  }

  const claimLineIdRaw = formData.get("claimLineId");
  const claimLineId = typeof claimLineIdRaw === "string" && claimLineIdRaw.length > 0 ? claimLineIdRaw : null;
  if (claimLineId && !isValidId(claimLineId)) {
    return NextResponse.json({ success: false, message: "Invalid claimLineId." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await uploadClaimAttachment(id, claimLineId, buffer, file.name || "upload", file.type || "application/octet-stream", user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id, downloadUrl: `/api/invoice-claims/attachments/${result.id}` }, { status: 201 });
  } catch (error) {
    console.error("Invoice claim attachment upload failed:", error);
    return NextResponse.json({ success: false, message: "Unable to save this attachment." }, { status: 500 });
  }
}
