import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { canUseLiveWhatsAppAdapter, getWhatsAppWebhookSecret } from "@/lib/channels/config";
import { verifyWhatsAppWebhookSignature } from "@/lib/channels/webhook-security";
import { recordInboundMessage } from "@/lib/channels/intake-review";
import { fetchWhatsAppMedia } from "@/lib/channels/whatsapp/media";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The inbound side
 * of WhatsApp intake (spec point 2). Matches the WhatsApp Business Cloud
 * API's own documented webhook contract exactly -- GET for the one-time
 * subscription handshake, POST for message delivery, both UNVERIFIED
 * against a real WhatsApp Business Account (see lib/channels/whatsapp/
 * real-adapter.ts's header comment: Willsgrove has none).
 *
 * In this project's actual, current deployment, this route can never
 * receive real traffic at all -- registering a webhook with Meta
 * requires a WhatsApp Business Account and an approved Meta App, neither
 * of which exists. It is implemented completely and correctly against
 * Meta's public documentation anyway (spec's "design for an officially
 * supported WhatsApp Business integration"), so that the day Willsgrove
 * does set up a real account, connecting it is a matter of configuring
 * environment variables (see .env.example's Milestone 10 section) and
 * registering this exact URL with Meta, not rewriting this file.
 */

export async function GET(request: NextRequest) {
  // Meta's webhook subscription verification handshake: it calls this
  // URL once, with these three query parameters, and expects the raw
  // text of hub.challenge echoed back with a 200 IF hub.verify_token
  // matches the value configured in the Meta App dashboard (mirrored
  // here as CHANNEL_WHATSAPP_WEBHOOK_SECRET -- the same secret this
  // project's own webhook-security.ts doc calls out as WhatsApp's
  // equivalent of email's shared-secret check, repurposed by Meta's own
  // convention for this one-time handshake rather than a per-request
  // signature).
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  const configuredSecret = getWhatsAppWebhookSecret();
  if (!configuredSecret || mode !== "subscribe" || token !== configuredSecret || !challenge) {
    return NextResponse.json({ success: false, message: "WhatsApp intake is not configured, or this verification request is invalid." }, { status: 403 });
  }

  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

type WhatsAppMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
};

type WhatsAppWebhookPayload = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: WhatsAppMessage[];
      };
    }[];
  }[];
};

export async function POST(request: NextRequest) {
  const configuredSecret = getWhatsAppWebhookSecret();
  if (!configuredSecret) {
    return NextResponse.json({ success: false, message: "WhatsApp intake is not configured on this deployment." }, { status: 503 });
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json({ success: false, message: "Unable to read the request body." }, { status: 400 });
  }

  // Must verify against the raw bytes exactly as received -- see
  // lib/channels/webhook-security.ts's own comment on why this is read
  // as text BEFORE any JSON parsing.
  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!verifyWhatsAppWebhookSignature(rawText, signatureHeader, configuredSecret)) {
    return NextResponse.json({ success: false, message: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    console.error("WhatsApp webhook: payload is not valid JSON.");
    return NextResponse.json({ success: true, accepted: false });
  }

  const messages = payload.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []) ?? [];
  const contactName = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ?? null;

  let anyFailed = false;
  for (const message of messages) {
    if (!message.from || !message.id) continue;

    const attachments: { bytes: Buffer; originalFileName: string; claimedMimeType: string }[] = [];
    let bodyText = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? null;

    const media = message.image ?? message.document;
    if (media?.id) {
      if (canUseLiveWhatsAppAdapter()) {
        const fetched = await fetchWhatsAppMedia(media.id);
        if (fetched) {
          attachments.push({
            bytes: fetched.bytes,
            // message.document is the only one of the two media variants
            // that ever carries a filename (WhatsApp never sends one for
            // image messages) -- read it directly from message.document
            // rather than narrowing the merged `media` union, which TS's
            // `in` operator does not narrow cleanly here.
            originalFileName: message.document?.filename ?? `whatsapp-media-${media.id}`,
            claimedMimeType: fetched.mimeType || media.mime_type || "application/octet-stream",
          });
        } else {
          bodyText = `${bodyText ?? ""}\n[An attached file could not be downloaded from WhatsApp.]`.trim();
        }
      } else {
        // No live WhatsApp credentials configured (this project's actual
        // current state) -- there is nothing to download with, and
        // pretending otherwise would violate spec point 2's "do not
        // pretend that WhatsApp is connected when it is not." Record the
        // text honestly as a placeholder note instead of silently
        // dropping the fact that an attachment existed.
        bodyText = `${bodyText ?? ""}\n[Customer sent an attachment; WhatsApp media download is not configured on this deployment.]`.trim();
      }
    }

    const result = await recordInboundMessage({
      channel: "WHATSAPP",
      externalMessageId: message.id,
      fromAddress: message.from,
      fromDisplayName: contactName,
      bodyText,
      rawPayload: payload as unknown as Prisma.InputJsonValue,
      receivedAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
      attachments,
    });

    if (!result.ok) {
      console.error("WhatsApp webhook: recordInboundMessage failed:", result.message);
      if (result.status >= 500) anyFailed = true;
    }
  }

  if (anyFailed) {
    return NextResponse.json({ success: false, message: "Temporarily unable to process one or more messages." }, { status: 502 });
  }
  return NextResponse.json({ success: true, accepted: messages.length > 0 });
}
