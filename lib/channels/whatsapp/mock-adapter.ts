import { randomUUID } from "crypto";
import type { ChannelAdapter, ChannelOutboundMessage, ChannelSendResult } from "@/lib/channels/types";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Deterministic mock
 * WhatsApp adapter -- the CHANNEL_WHATSAPP_PROVIDER=mock default
 * (lib/channels/config.ts), and in practice the ONLY adapter this
 * deployment will ever run, since Willsgrove has no WhatsApp Business
 * Account configured (spec point 2: "do not pretend that WhatsApp is
 * connected when it is not"). See lib/channels/whatsapp/real-adapter.ts's
 * own header comment for exactly what would need to exist before live
 * mode could ever be reached.
 *
 * Same deterministic failure-simulation convention as
 * lib/channels/email/mock-adapter.ts (a `to` value containing
 * "__SIMULATE_FAILURE__").
 */
export class MockWhatsAppAdapter implements ChannelAdapter {
  async send(message: ChannelOutboundMessage): Promise<ChannelSendResult> {
    if (message.to.includes("__SIMULATE_FAILURE__")) {
      return { ok: false, message: "Mock WhatsApp provider rejected the message (simulated failure)." };
    }
    return { ok: true, providerMessageId: `mock-whatsapp-${randomUUID()}` };
  }
}
