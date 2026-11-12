import { NextRequest, NextResponse } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { recordInboundMessage, MAX_ATTACHMENT_BYTES } from "@/lib/channels/intake-review";

/**
 * Milestone 10 (Communication Channels & Fulfilment). POST
 * /api/channels/manual-intake -- the manual intake fallback spec point 2
 * explicitly requires ("provide a manual intake fallback where no
 * authorised integration exists"). A staff member who received an order
 * by a phone call, or by WhatsApp/email before any webhook is configured
 * on this deployment, keys in what the customer said here instead of it
 * going unrecorded. This is a genuinely authenticated, browser-facing
 * route (CSRF-checked, any signed-in role -- same "no dedicated role"
 * posture as picking/lost-sales recording), unlike the two webhook
 * routes above, which have no session to check at all.
 *
 * Produces the exact same MessageIntake row shape the webhooks do --
 * this form is not a shortcut into the PO extraction pipeline, it is
 * simply a different way a RECEIVED row gets created; it still goes
 * through the same review queue and the same createPoIntake() conversion
 * step as an emailed or WhatsApp'd message would.
 */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "Expected multipart/form-data." }, { status: 400 });
  }

  const channelRaw = formData.get("channel");
  const channel = channelRaw === "EMAIL" || channelRaw === "WHATSAPP" ? channelRaw : "MANUAL";

  const fromAddress = formData.get("fromAddress");
  if (typeof fromAddress !== "string" || !fromAddress.trim()) {
    return NextResponse.json({ success: false, message: "The customer's email, phone number, or name is required." }, { status: 400 });
  }

  const fromDisplayName = formData.get("fromDisplayName");
  const subject = formData.get("subject");
  const bodyText = formData.get("bodyText");

  if ((typeof bodyText !== "string" || !bodyText.trim()) && !(formData.get("file") instanceof File)) {
    return NextResponse.json({ success: false, message: "Enter what the customer said, or attach the file they sent." }, { status: 400 });
  }

  const attachments: { bytes: Buffer; originalFileName: string; claimedMimeType: string }[] = [];
  const file = formData.get("file");
  if (file instanceof File) {
    if (file.size === 0) {
      return NextResponse.json({ success: false, message: "The attached file is empty." }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ success: false, message: "The attached file exceeds the 20 MB limit." }, { status: 413 });
    }
    attachments.push({
      bytes: Buffer.from(await file.arrayBuffer()),
      originalFileName: file.name || "attachment",
      claimedMimeType: file.type || "application/octet-stream",
    });
  }

  const result = await recordInboundMessage({
    channel,
    fromAddress: fromAddress.trim(),
    fromDisplayName: typeof fromDisplayName === "string" && fromDisplayName.trim() ? fromDisplayName.trim() : null,
    subject: typeof subject === "string" && subject.trim() ? subject.trim() : null,
    bodyText: typeof bodyText === "string" && bodyText.trim() ? bodyText.trim() : null,
    attachments,
  });

  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: result.status });
  }

  return NextResponse.json({ success: true, messageIntakeId: result.messageIntakeId }, { status: 201 });
}
