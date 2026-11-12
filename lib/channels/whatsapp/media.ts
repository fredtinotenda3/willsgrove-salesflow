import "server-only";
import { resolveWhatsAppLiveCredentials } from "@/lib/channels/config";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Downloads an
 * inbound WhatsApp media attachment (image/document) by its media id --
 * the WhatsApp Business Cloud API never embeds attachment bytes directly
 * in a webhook payload (unlike Postmark's inbound email webhook, which
 * does). Meta's documented two-step flow:
 *   1. GET https://graph.facebook.com/v21.0/{media-id} (Authorization:
 *      Bearer <token>) -- returns a short-lived signed download URL plus
 *      the media's mime_type and file_size.
 *   2. GET that signed URL (also with the same Authorization header --
 *      Meta's signed media URLs still require the access token) --
 *      returns the raw bytes.
 *
 * **UNVERIFIED** against a real WhatsApp Business Account, for the exact
 * same reason lib/channels/whatsapp/real-adapter.ts is -- see that
 * file's own header comment. This function is only ever called from the
 * WhatsApp webhook route handler, and only when canUseLiveWhatsAppAdapter()
 * is true -- with no live credentials configured (the default, and the
 * only state this project's own deployment will ever actually be in),
 * the webhook route stores a text-only placeholder note instead of
 * attempting a media fetch (see app/api/channels/whatsapp/webhook/
 * route.ts).
 */
export async function fetchWhatsAppMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const credentials = resolveWhatsAppLiveCredentials();
  if (!credentials) return null;

  try {
    const metaResponse = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!metaResponse.ok) return null;
    const meta = (await metaResponse.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const fileResponse = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!fileResponse.ok) return null;

    const arrayBuffer = await fileResponse.arrayBuffer();
    return { bytes: Buffer.from(arrayBuffer), mimeType: meta.mime_type ?? "application/octet-stream" };
  } catch (error) {
    console.error("fetchWhatsAppMedia failed:", error);
    return null;
  }
}
