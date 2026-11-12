import "server-only";
import type { WhatsAppLiveCredentials } from "@/lib/channels/config";
import { sanitizeChannelErrorMessage } from "@/lib/channels/config";
import type { ChannelAdapter, ChannelOutboundMessage, ChannelSendResult } from "@/lib/channels/types";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The real WhatsApp
 * adapter -- targets Meta's own WhatsApp Business Cloud API
 * (https://graph.facebook.com/v21.0/{phone-number-id}/messages), the
 * officially supported integration path spec point 2 explicitly asks for
 * ("design for an officially supported WhatsApp Business integration"),
 * as opposed to any unofficial/browser-automation WhatsApp client, which
 * this project will never build or use.
 *
 * **UNVERIFIED AGAINST ANY REAL WHATSAPP BUSINESS ACCOUNT, AND NOT
 * CURRENTLY REACHABLE AT ALL.** Willsgrove has no WhatsApp Business
 * Account, no Meta App, no approved phone number, and no access token --
 * spec's explicit "do not invent external integrations, credentials, API
 * endpoints or WhatsApp access." This file exists purely as a
 * documented, reasonable-faith starting point against Meta's own
 * PUBLICLY PUBLISHED Cloud API documentation, never confirmed against a
 * real account. Before this adapter can honestly be used in production,
 * an organisation owner must, entirely outside this codebase:
 *   1. Create a Meta Business Account and a WhatsApp Business Account.
 *   2. Register and verify a business phone number with Meta.
 *   3. Create a Meta App, add the WhatsApp product, and generate a
 *      permanent (System User) access token -- a temporary token from
 *      the Meta App dashboard expires in 24 hours and is not suitable
 *      for a production deployment.
 *   4. Note Willsgrove's ordinary WhatsApp numbers used today are very
 *      likely still personal/standard WhatsApp (not WhatsApp Business
 *      Platform) numbers -- those are NOT compatible with this API at
 *      all and would need their own separate registration decision,
 *      which is an organisational decision this project does not make
 *      on Willsgrove's behalf (see docs/milestones/PROGRESS.md's
 *      Milestone 10 "external dependencies" section).
 *   5. Supply CHANNEL_WHATSAPP_PHONE_NUMBER_ID and
 *      CHANNEL_WHATSAPP_ACCESS_TOKEN (see .env.example) and set
 *      CHANNEL_WHATSAPP_PROVIDER=live.
 * Until all five are done, getAdapter() (lib/channels/get-adapter.ts)
 * will never construct this class -- see canUseLiveWhatsAppAdapter() --
 * and every WhatsApp send in this deployment runs against the mock
 * adapter, honestly, with no pretence otherwise (see
 * app/communications/settings for how this is surfaced to an
 * ADMINISTRATOR in the UI).
 *
 * One further documented limitation even once live: the Cloud API's
 * "session messaging" window only allows a free-form text message within
 * 24 hours of the customer's own last inbound message; outside that
 * window, Meta requires a pre-approved message TEMPLATE. This adapter
 * sends a plain free-form text message only -- template support is not
 * implemented, since no Meta-approved templates exist for this
 * deployment yet (another organisational step, not a code gap this file
 * can close). A send attempted outside the session window will be
 * rejected by Meta with an error this adapter surfaces honestly as
 * `{ ok: false }`, never silently swallowed.
 */
export class RealWhatsAppAdapter implements ChannelAdapter {
  constructor(private readonly credentials: WhatsAppLiveCredentials) {}

  async send(message: ChannelOutboundMessage): Promise<ChannelSendResult> {
    try {
      const response = await fetch(`https://graph.facebook.com/v21.0/${this.credentials.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.credentials.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: message.to,
          type: "text",
          text: { body: message.bodyText },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const body = (await response.json().catch(() => null)) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number };
      } | null;

      const providerMessageId = body?.messages?.[0]?.id;
      if (!response.ok || !providerMessageId) {
        const detail = body?.error?.message || `HTTP ${response.status}`;
        return { ok: false, message: sanitizeChannelErrorMessage(`WhatsApp provider rejected the message: ${detail}`, this.credentials.accessToken) };
      }

      return { ok: true, providerMessageId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, message: sanitizeChannelErrorMessage(`WhatsApp send failed: ${detail}`, this.credentials.accessToken) };
    }
  }
}
