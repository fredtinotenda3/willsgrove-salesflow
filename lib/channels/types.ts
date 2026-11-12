/**
 * Milestone 10 (Communication Channels & Fulfilment). The channel adapter
 * contract -- the ONE place lib/communications/dispatcher.ts is allowed to
 * reach for an actual send, mirroring lib/integrations/sap/types.ts's own
 * SapAdapter contract exactly (spec's own instruction to extend existing
 * patterns rather than invent new ones).
 *
 * Deliberately send-only. Unlike SapAdapter, there is no fetch-or-read
 * side to this interface at all -- inbound messages never arrive through an
 * adapter method call. A real deployment's email/WhatsApp provider
 * delivers inbound mail/messages to this app via an HTTP webhook (see
 * app/api/channels/email/webhook/route.ts and .../whatsapp/webhook/
 * route.ts), which is a request SalesFlow receives, not one it initiates
 * -- there is nothing to abstract behind a "fetchMessages()" method, and
 * inventing one would misrepresent how either provider's inbound side
 * actually works.
 */

export type ChannelSendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      /** Sanitized -- never a raw secret or full provider stack trace,
       * same convention as SapAdapterError/IntegrationOperation.
       * lastErrorMessage. Safe to store on OutboundMessage.lastErrorMessage
       * and show in the UI. */
      message: string;
    };

export interface ChannelOutboundMessage {
  /** Email address or WhatsApp phone number (E.164, no leading "+" per
   * the WhatsApp Business Cloud API's own documented convention) --
   * already resolved by the caller; this interface never looks up a
   * customer record itself. */
  to: string;
  /** Email only. Ignored by the WhatsApp adapter -- WhatsApp messages
   * have no subject line. */
  subject?: string;
  bodyText: string;
}

export interface ChannelAdapter {
  /**
   * Sends one message. Deliberately never throws for an ORDINARY
   * provider-side send failure (bad address, provider rejection, rate
   * limit) -- returns { ok: false, message } instead, which
   * lib/communications/dispatcher.ts records as
   * OutboundMessageStatus.FAILED (never auto-retried; see that model's
   * own schema comment). May still throw for a genuine programming/
   * configuration error (e.g. a real adapter constructed with no
   * credentials at all) -- that is a bug, not a business outcome, and
   * dispatcher.ts's own try/catch converts it to the same FAILED
   * outcome so a misconfiguration can never crash the calling route.
   */
  send(message: ChannelOutboundMessage): Promise<ChannelSendResult>;
}
