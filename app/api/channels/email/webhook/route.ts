import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getEmailWebhookSecret } from "@/lib/channels/config";
import { verifyEmailWebhookSecret } from "@/lib/channels/webhook-security";
import { recordInboundMessage } from "@/lib/channels/intake-review";

/**
 * Milestone 10 (Communication Channels & Fulfilment). POST
 * /api/channels/email/webhook -- the inbound side of email intake (spec
 * point 1). Deliberately NOT behind requireUserOrResponse()/
 * verifyCsrfOrigin(): the caller is an external email provider's server,
 * never a signed-in browser session, so there is no session cookie to
 * check and the Origin-based CSRF check (lib/auth/csrf.ts, built for
 * cookie-authenticated browser requests) would only ever reject a
 * legitimate provider call. Authenticity here is the shared-secret query
 * parameter instead -- see lib/channels/webhook-security.ts's own header
 * comment for why email and WhatsApp use genuinely different mechanisms.
 *
 * Payload shape matches Postmark's own documented "inbound webhook" JSON
 * (https://postmarkapp.com/developer/webhooks/inbound-webhook) -- the
 * provider this app's real-adapter.ts targets (see that file's header
 * comment for why). UNVERIFIED against a real Postmark account, exactly
 * like every other provider-shaped code this milestone adds.
 *
 * Returns 200 for every outcome except an authenticity failure or an
 * internal error -- a malformed-but-authenticated payload (e.g. an
 * attachment of an unsupported type) is logged and acknowledged rather
 * than returned as an error status, since Postmark (like most webhook
 * providers) retries non-2xx responses, and a sender's own malformed
 * message will never become well-formed on retry.
 */

const MAX_WEBHOOK_BODY_CHARS = 25 * 1024 * 1024; // generous enough for a PO + a scanned-PDF attachment, base64-inflated

type PostmarkAttachment = {
  Name?: string;
  Content?: string; // base64
  ContentType?: string;
  ContentLength?: number;
};

type PostmarkInboundPayload = {
  MessageID?: string;
  From?: string;
  FromName?: string;
  Subject?: string;
  TextBody?: string;
  Date?: string;
  Attachments?: PostmarkAttachment[];
};

export async function POST(request: NextRequest) {
  const configuredSecret = getEmailWebhookSecret();
  if (!configuredSecret) {
    return NextResponse.json({ success: false, message: "Email intake is not configured on this deployment." }, { status: 503 });
  }

  const providedSecret = request.nextUrl.searchParams.get("secret");
  if (!verifyEmailWebhookSecret(providedSecret, configuredSecret)) {
    return NextResponse.json({ success: false, message: "Invalid or missing webhook secret." }, { status: 401 });
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json({ success: false, message: "Unable to read the request body." }, { status: 400 });
  }
  if (rawText.length > MAX_WEBHOOK_BODY_CHARS) {
    return NextResponse.json({ success: false, message: "Payload too large." }, { status: 413 });
  }

  let payload: PostmarkInboundPayload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    // Acknowledge rather than error -- see module comment.
    console.error("Email webhook: payload is not valid JSON.");
    return NextResponse.json({ success: true, accepted: false });
  }

  if (!payload.From) {
    console.error("Email webhook: payload has no From address.");
    return NextResponse.json({ success: true, accepted: false });
  }

  const attachments: { bytes: Buffer; originalFileName: string; claimedMimeType: string }[] = [];
  for (const raw of payload.Attachments ?? []) {
    if (!raw.Content || !raw.Name) continue;
    try {
      attachments.push({
        bytes: Buffer.from(raw.Content, "base64"),
        originalFileName: raw.Name,
        claimedMimeType: raw.ContentType || "application/octet-stream",
      });
    } catch {
      // Malformed base64 on one attachment -- skip it, keep the rest of
      // the message intact rather than rejecting the whole webhook.
      console.error(`Email webhook: attachment "${raw.Name}" has unreadable content; skipped.`);
    }
  }

  // rawPayload is stored for audit/debugging (MessageIntake.rawPayload)
  // but deliberately WITHOUT the attachments' base64 content -- that
  // content is already stored once, properly, as MessageAttachment
  // bytes via the storage driver; keeping a second base64 copy inline in
  // a JSON column would roughly double storage for every attachment for
  // no benefit.
  const rawPayloadForAudit = { ...payload, Attachments: (payload.Attachments ?? []).map((a) => ({ Name: a.Name, ContentType: a.ContentType, ContentLength: a.ContentLength })) };

  const result = await recordInboundMessage({
    channel: "EMAIL",
    externalMessageId: payload.MessageID ?? null,
    fromAddress: payload.From,
    fromDisplayName: payload.FromName ?? null,
    subject: payload.Subject ?? null,
    bodyText: payload.TextBody ?? null,
    rawPayload: rawPayloadForAudit as unknown as Prisma.InputJsonValue,
    receivedAt: payload.Date ? new Date(payload.Date) : new Date(),
    attachments,
  });

  if (!result.ok) {
    console.error("Email webhook: recordInboundMessage failed:", result.message);
    if (result.status >= 500) {
      // A genuine internal failure (e.g. the database was briefly
      // unreachable) -- return non-2xx so Postmark's own retry schedule
      // gives this a second chance, unlike a structural validation
      // failure (400/413/415), which is acknowledged below since no
      // retry will ever fix malformed input this app has already fully
      // parsed and rejected.
      return NextResponse.json({ success: false, message: "Temporarily unable to process this message." }, { status: 502 });
    }
    return NextResponse.json({ success: true, accepted: false });
  }

  return NextResponse.json({ success: true, accepted: true, duplicate: result.duplicate });
}
