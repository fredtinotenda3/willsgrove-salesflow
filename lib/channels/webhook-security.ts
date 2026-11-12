import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Inbound webhook
 * verification -- the ONE place either channel's webhook route handler
 * (app/api/channels/email/webhook/route.ts, app/api/channels/whatsapp/
 * webhook/route.ts) checks that a request actually came from the
 * configured provider, never from an anonymous caller forging a
 * MessageIntake. Both webhook routes reject a request that fails this
 * check with 401/403 BEFORE creating any MessageIntake row -- spec
 * point 1/2's "associate incoming messages... with the correct customer"
 * presupposes the message is genuine in the first place.
 *
 * The two providers this project's real-adapter.ts files target use
 * genuinely different, provider-documented mechanisms, so this
 * deliberately does NOT force both into one generic "verifyWebhook()"
 * shape:
 *
 *   - WhatsApp Business Cloud API (Meta) signs every webhook delivery
 *     with an HMAC-SHA256 of the raw request body, keyed by the Meta
 *     App Secret, sent as the `X-Hub-Signature-256: sha256=<hex>`
 *     header -- this is Meta's own publicly documented mechanism, used
 *     unchanged here.
 *   - Postmark's inbound webhook has NO request-signing mechanism at
 *     all; Postmark's own documented recommendation is HTTP Basic Auth
 *     or a shared secret embedded in the webhook URL itself, verified
 *     by the receiving application. verifyEmailWebhookSecret below
 *     implements the shared-secret-in-URL variant, since it requires no
 *     additional header-parsing convention beyond what this app already
 *     controls (the URL it registers with Postmark).
 *
 * Both are UNVERIFIED in the same sense every other Milestone 10
 * provider-shaped code is (see lib/channels/email/real-adapter.ts and
 * lib/channels/whatsapp/real-adapter.ts's own header comments) -- this
 * file implements each provider's publicly documented mechanism
 * faithfully, but neither has been exercised against a real account's
 * actual webhook delivery.
 */

/**
 * Verifies a WhatsApp Cloud API webhook's `X-Hub-Signature-256` header
 * against the raw (unparsed) request body. MUST be called with the exact
 * raw bytes Meta sent -- re-serializing a parsed-and-reparsed JSON body
 * can produce a byte-for-byte different string and an honest signature
 * mismatch, so the webhook route reads the body as text/bytes first and
 * only parses it as JSON after this check passes.
 */
export function verifyWhatsAppWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader) return false;
  const expectedPrefix = "sha256=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;

  const providedHex = signatureHeader.slice(expectedPrefix.length);
  const computedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  // Equal-length check first: timingSafeEqual throws on mismatched buffer
  // lengths rather than returning false, and a length mismatch itself
  // reveals nothing timing-sensitive worth protecting.
  if (providedHex.length !== computedHex.length) return false;

  return timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(computedHex, "hex"));
}

/**
 * Verifies the shared secret Postmark's inbound webhook was configured
 * (in the Postmark dashboard, entirely outside this codebase) to include
 * as a `secret` query parameter on the webhook URL itself. A plain
 * string comparison would leak timing information about how many
 * leading characters matched; timingSafeEqual avoids that even though
 * the practical risk for a webhook URL query parameter (as opposed to a
 * password field) is low.
 */
export function verifyEmailWebhookSecret(providedSecret: string | null, expectedSecret: string): boolean {
  if (!providedSecret) return false;
  const provided = Buffer.from(providedSecret, "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
