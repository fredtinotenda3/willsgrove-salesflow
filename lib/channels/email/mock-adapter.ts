import { randomUUID } from "crypto";
import type { ChannelAdapter, ChannelOutboundMessage, ChannelSendResult } from "@/lib/channels/types";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Deterministic mock
 * email adapter -- the CHANNEL_EMAIL_PROVIDER=mock default
 * (lib/channels/config.ts), used for all local development and automated
 * tests. Mirrors lib/integrations/sap/mock-adapter.ts's own "a mock
 * genuinely cannot reach a real provider, so it does not pretend to"
 * stance: nothing here makes an HTTP call, and every send is recorded
 * only in this process's own return value and whatever the caller
 * persists (OutboundMessage) -- there is no second, in-memory "sent mail"
 * store to keep in sync with the database, unlike SAP's submittedOrders
 * map, because there is no cross-call idempotency behaviour this mock
 * needs to simulate for email/WhatsApp (OutboundMessage.idempotencyKey's
 * own @unique constraint is already the full guard -- see that model's
 * schema comment).
 *
 * Deterministic failure simulation, for tests only, recognised ONLY by
 * this mock and never advertised to end users: a recipient address
 * containing the literal substring "__SIMULATE_FAILURE__" returns
 * { ok: false } instead of succeeding, exercising
 * lib/communications/dispatcher.ts's FAILED path without needing a real
 * provider to actually reject something.
 */
export class MockEmailAdapter implements ChannelAdapter {
  async send(message: ChannelOutboundMessage): Promise<ChannelSendResult> {
    if (message.to.includes("__SIMULATE_FAILURE__")) {
      return { ok: false, message: "Mock email provider rejected the message (simulated failure)." };
    }
    return { ok: true, providerMessageId: `mock-email-${randomUUID()}` };
  }
}
