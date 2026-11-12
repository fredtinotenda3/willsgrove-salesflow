import "server-only";
import type { EmailLiveCredentials } from "@/lib/channels/config";
import { sanitizeChannelErrorMessage } from "@/lib/channels/config";
import type { ChannelAdapter, ChannelOutboundMessage, ChannelSendResult } from "@/lib/channels/types";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The real email
 * adapter -- targets Postmark's transactional email API
 * (https://api.postmarkapp.com/email), chosen as the reference shape
 * because its request/response contract is one of the simplest
 * documented transactional-email APIs (a single JSON POST, a token
 * header, no OAuth dance) and because its shape (From/To/Subject/
 * TextBody, a "MessageID" on success, an {"ErrorCode","Message"} object
 * on failure) is representative enough of SendGrid/Mailgun/SES that
 * swapping providers later is a small, contained change to this one
 * file, not a redesign of the ChannelAdapter contract.
 *
 * **UNVERIFIED AGAINST ANY REAL PROVIDER ACCOUNT.** This project has no
 * Postmark (or any other transactional email provider) account,
 * credentials, or sending domain configured for Willsgrove -- spec's
 * explicit "do not invent external integrations, credentials, API
 * endpoints." Everything below is implemented against Postmark's own
 * PUBLICLY PUBLISHED API documentation, never confirmed against a real
 * account. Before this adapter can honestly be used in production,
 * Willsgrove (or whichever engineer sets this up) must:
 *   1. Choose an actual provider (Postmark, SendGrid, Mailgun, Amazon
 *      SES, or any other) -- this file's shape is a starting point, not
 *      a procurement decision made on the organisation's behalf.
 *   2. Register a sending domain and complete that provider's own
 *      domain-verification (SPF/DKIM/DMARC) steps -- an unverified
 *      sending domain gets emails marked as spam or rejected outright by
 *      most receiving mail servers, regardless of what this code does.
 *   3. Supply CHANNEL_EMAIL_API_KEY and CHANNEL_EMAIL_FROM_ADDRESS (see
 *      .env.example) and set CHANNEL_EMAIL_PROVIDER=live.
 * Until all three are done, getAdapter() (lib/channels/get-adapter.ts)
 * will never construct this class -- see canUseLiveEmailAdapter().
 */
export class RealEmailAdapter implements ChannelAdapter {
  constructor(private readonly credentials: EmailLiveCredentials) {}

  async send(message: ChannelOutboundMessage): Promise<ChannelSendResult> {
    try {
      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Server-Token": this.credentials.apiKey,
        },
        body: JSON.stringify({
          From: this.credentials.fromAddress,
          To: message.to,
          Subject: message.subject ?? "",
          TextBody: message.bodyText,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const body = (await response.json().catch(() => null)) as { MessageID?: string; ErrorCode?: number; Message?: string } | null;

      if (!response.ok || !body?.MessageID) {
        const detail = body?.Message || `HTTP ${response.status}`;
        return { ok: false, message: sanitizeChannelErrorMessage(`Email provider rejected the message: ${detail}`, this.credentials.apiKey) };
      }

      return { ok: true, providerMessageId: body.MessageID };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, message: sanitizeChannelErrorMessage(`Email send failed: ${detail}`, this.credentials.apiKey) };
    }
  }
}
