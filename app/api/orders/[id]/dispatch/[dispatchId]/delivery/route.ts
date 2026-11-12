import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getStorageDriver } from "@/lib/storage";
import { validateUploadContent } from "@/lib/storage/content-sniff";
import { recordDeliverySchema } from "@/lib/fulfilment/validation";
import { recordDelivery } from "@/lib/fulfilment/delivery";
import { queueDeliveryOutcomeMessage } from "@/lib/communications/send";

type RouteContext = { params: Promise<{ id: string; dispatchId: string }> };

// Same ceiling as lib/channels/intake-review.ts's MAX_ATTACHMENT_BYTES /
// lib/po-intake.ts's MAX_PO_INTAKE_BYTES -- one consistent upload-size
// convention across the app, not a fresh number picked for this route.
const MAX_PROOF_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/orders/[id]/dispatch/[dispatchId]/delivery
 *
 * Milestone 10 (Communication Channels & Fulfilment). Records the
 * delivery outcome for a DEPARTED dispatch -- multipart/form-data, not
 * JSON, because an optional proof-of-delivery photo and/or signature
 * image travel alongside the structured line data. The structured part
 * (lines/recipientName/notes) is sent as a single "payload" field holding
 * JSON text, validated with the exact same recordDeliverySchema a JSON
 * body would use elsewhere in this project -- there is no existing
 * multipart-plus-JSON convention to follow here (every other upload route
 * in this app carries no structured sibling data), so this is a
 * deliberately minimal, self-contained choice for this one route rather
 * than a new general pattern.
 *
 * Any authenticated role -- same "no dedicated role" posture as the rest
 * of dispatch/delivery recording.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { dispatchId } = await context.params;
  if (!isValidId(dispatchId)) {
    return NextResponse.json({ success: false, message: "Invalid dispatch id." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, message: "Expected multipart/form-data." }, { status: 400 });
  }

  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") {
    return NextResponse.json({ success: false, message: "Missing delivery payload." }, { status: 400 });
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(payloadRaw);
  } catch {
    return NextResponse.json({ success: false, message: "The delivery payload is not valid JSON." }, { status: 400 });
  }

  const parsed = recordDeliverySchema.safeParse(payloadJson);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid delivery data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const storage = getStorageDriver();
  const proof: { proofPhotoStorageKey?: string; proofSignatureStorageKey?: string } = {};

  for (const [field, key] of [
    ["proofPhoto", "proofPhotoStorageKey"],
    ["proofSignature", "proofSignatureStorageKey"],
  ] as const) {
    const file = formData.get(field);
    if (!(file instanceof File)) continue;
    if (file.size === 0) continue;
    if (file.size > MAX_PROOF_BYTES) {
      return NextResponse.json({ success: false, message: `The ${field === "proofPhoto" ? "proof photo" : "signature"} exceeds the 20 MB limit.` }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const validation = validateUploadContent(bytes, file.type || "application/octet-stream");
    if (!validation.ok) {
      return NextResponse.json({ success: false, message: validation.message }, { status: 400 });
    }

    const stored = await storage.put(bytes, file.name);
    proof[key] = stored.storageKey;
  }

  try {
    const result = await recordDelivery(dispatchId, user.id, parsed.data, proof);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    // Milestone 10. See app/api/quotations/[id]/issue/route.ts's identical
    // comment -- a notification failure never affects this response.
    try {
      await queueDeliveryOutcomeMessage(result.deliveryRecordId, user.id);
    } catch (notifyError) {
      console.error(`Failed to queue delivery-outcome message for delivery ${result.deliveryRecordId}:`, notifyError);
    }

    return NextResponse.json({ success: true, deliveryRecordId: result.deliveryRecordId, outcome: result.outcome }, { status: 201 });
  } catch (error) {
    console.error("Recording a delivery outcome failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this delivery outcome." }, { status: 500 });
  }
}
