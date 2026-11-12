import "server-only";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Server-side-only
 * configuration resolution for the email/WhatsApp channel adapters --
 * mirrors lib/integrations/sap/config.ts's own two-layer design exactly:
 *
 * 1. CHANNEL_EMAIL_PROVIDER / CHANNEL_WHATSAPP_PROVIDER ("mock" | "live",
 *    default "mock") are deployment-level kill switches, settable only by
 *    whoever controls the server's environment, never through this app's
 *    UI or database. Spec point 2's "do not pretend that WhatsApp is
 *    connected when it is not" is enforced structurally here: WhatsApp
 *    defaults to mock and NOTHING in this codebase can flip it to live
 *    except this one environment variable plus a complete, real set of
 *    WhatsApp Business credentials (see resolveWhatsAppLiveCredentials
 *    below) -- there is no UI "Enable WhatsApp" toggle anywhere that can
 *    make live mode true on its own, the same defense-in-depth posture
 *    get-adapter.ts below applies.
 * 2. The actual provider credentials/tokens live ONLY in the environment.
 *    They are never returned by any API route, never stored in the
 *    database, and never logged.
 */

export type ChannelDeploymentMode = "mock" | "live";

export function getEmailDeploymentMode(): ChannelDeploymentMode {
  return process.env.CHANNEL_EMAIL_PROVIDER === "live" ? "live" : "mock";
}

export function getWhatsAppDeploymentMode(): ChannelDeploymentMode {
  return process.env.CHANNEL_WHATSAPP_PROVIDER === "live" ? "live" : "mock";
}

/**
 * Postmark/SendGrid-shaped -- see lib/channels/email/real-adapter.ts's own
 * header comment for exactly which of the two this targets and why.
 * EMAIL_FROM_ADDRESS is the one piece shared with no existing env var in
 * this project (see .env.example's new "Milestone 10" section).
 */
export interface EmailLiveCredentials {
  apiKey: string;
  fromAddress: string;
}

export function resolveEmailLiveCredentials(): EmailLiveCredentials | null {
  const apiKey = process.env.CHANNEL_EMAIL_API_KEY;
  const fromAddress = process.env.CHANNEL_EMAIL_FROM_ADDRESS;
  if (!apiKey || !fromAddress) return null;
  return { apiKey, fromAddress };
}

export function canUseLiveEmailAdapter(): boolean {
  return getEmailDeploymentMode() === "live" && resolveEmailLiveCredentials() !== null;
}

/**
 * WhatsApp Business Cloud API-shaped (Meta's own hosted API -- see
 * lib/channels/whatsapp/real-adapter.ts's own header comment). A real
 * deployment needs a phone number ID (the sending number, provisioned in
 * Meta's WhatsApp Business Platform) and a permanent access token, both
 * of which only an organisation with an approved WhatsApp Business
 * Account can obtain -- this project has neither, and does not invent
 * either (spec's explicit "do not invent external integrations,
 * credentials, API endpoints or WhatsApp access").
 */
export interface WhatsAppLiveCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export function resolveWhatsAppLiveCredentials(): WhatsAppLiveCredentials | null {
  const phoneNumberId = process.env.CHANNEL_WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.CHANNEL_WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

export function canUseLiveWhatsAppAdapter(): boolean {
  return getWhatsAppDeploymentMode() === "live" && resolveWhatsAppLiveCredentials() !== null;
}

/**
 * Shared secret used to verify an inbound webhook actually came from the
 * configured provider (lib/channels/webhook-security.ts) -- separate
 * secrets per channel, since a real deployment's email provider and
 * WhatsApp Business Platform are two unrelated third parties with their
 * own independent signing schemes.
 */
export function getEmailWebhookSecret(): string | null {
  return process.env.CHANNEL_EMAIL_WEBHOOK_SECRET || null;
}

export function getWhatsAppWebhookSecret(): string | null {
  return process.env.CHANNEL_WHATSAPP_WEBHOOK_SECRET || null;
}

/**
 * Strips anything that could conceivably be a credential out of an error
 * message before it is stored (OutboundMessage.lastErrorMessage) or shown
 * in the UI -- same last-line-of-defence convention as
 * lib/integrations/sap/config.ts's sanitizeSapErrorMessage, deliberately
 * kept this simple since neither provider's documented error responses
 * are expected to echo back a token at all.
 */
export function sanitizeChannelErrorMessage(message: string, secret?: string): string {
  let sanitized = message;
  if (secret) {
    sanitized = sanitized.split(secret).join("[REDACTED]");
  }
  sanitized = sanitized.replace(/Authorization:\s*\S+(?:\s+\S+)?/gi, "Authorization: [REDACTED]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  return sanitized.length > 500 ? `${sanitized.slice(0, 500)}…` : sanitized;
}
