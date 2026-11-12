import "server-only";
import {
  canUseLiveEmailAdapter,
  canUseLiveWhatsAppAdapter,
  resolveEmailLiveCredentials,
  resolveWhatsAppLiveCredentials,
} from "@/lib/channels/config";
import { MockEmailAdapter } from "@/lib/channels/email/mock-adapter";
import { RealEmailAdapter } from "@/lib/channels/email/real-adapter";
import { MockWhatsAppAdapter } from "@/lib/channels/whatsapp/mock-adapter";
import { RealWhatsAppAdapter } from "@/lib/channels/whatsapp/real-adapter";
import type { ChannelAdapter } from "@/lib/channels/types";
// Type-only: matches this project's existing convention (see
// lib/po-intake.ts's own module comment) of importing a Prisma-generated
// enum as a TYPE ONLY, never dereferencing the generated enum object at
// runtime -- every runtime value in this file is a plain string literal,
// structurally assignable to this type without needing the (stale, in
// this sandbox) generated client's enum object to exist at runtime.
import type { MessageChannel } from "@prisma/client";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The ONE choke point
 * lib/communications/dispatcher.ts goes through to reach an email or
 * WhatsApp provider -- no other file in this codebase is allowed to
 * `new MockEmailAdapter()`/`new RealEmailAdapter()`/etc. directly. Exact
 * mirror of lib/integrations/sap/get-adapter.ts's own resolution order
 * and "fall back to mock rather than throw" posture.
 *
 * MANUAL is not resolvable to a ChannelAdapter at all -- there is
 * structurally nothing to send electronically for that channel (see
 * OutboundMessage.toAddress's own schema comment); callers must branch on
 * channel === "MANUAL" before ever calling this function, and
 * lib/communications/dispatcher.ts does exactly that.
 */
export function getChannelAdapter(channel: Exclude<MessageChannel, "MANUAL">): ChannelAdapter {
  if (channel === "EMAIL") {
    if (!canUseLiveEmailAdapter()) return new MockEmailAdapter();
    const credentials = resolveEmailLiveCredentials();
    if (!credentials) return new MockEmailAdapter();
    return new RealEmailAdapter(credentials);
  }

  // channel === "WHATSAPP"
  if (!canUseLiveWhatsAppAdapter()) return new MockWhatsAppAdapter();
  const credentials = resolveWhatsAppLiveCredentials();
  if (!credentials) return new MockWhatsAppAdapter();
  return new RealWhatsAppAdapter(credentials);
}

/** Used by UI/dashboard code (app/communications/settings) to show
 * "Running in MOCK mode" banners honestly for each channel, without
 * duplicating the resolution logic above -- same convention as
 * lib/integrations/sap/get-adapter.ts's isSapRunningInMockMode(). */
export function isEmailRunningInMockMode(): boolean {
  return !canUseLiveEmailAdapter();
}

export function isWhatsAppRunningInMockMode(): boolean {
  return !canUseLiveWhatsAppAdapter();
}
