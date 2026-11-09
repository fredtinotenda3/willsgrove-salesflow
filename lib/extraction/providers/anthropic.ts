/**
 * Milestone 2A. The real extraction provider, using the official
 * Anthropic SDK (Milestone 2 brief, section 3A). Server-side only -- the
 * API key never reaches the browser; see createAnthropicProvider below,
 * which is the only place process.env.ANTHROPIC_API_KEY is read.
 *
 * Structured output: uses the SDK's native `messages.parse()` with
 * `output_config.format: zodOutputFormat(...)`, which validates and
 * parses Claude's response against the exact same zod schema this
 * project already uses for every other extraction path
 * (lib/extraction/schema.ts) -- confirmed against this project's actual
 * installed SDK version (node_modules/@anthropic-ai/sdk, v1.6.0), not
 * assumed from memory. This is real and callable; what is NOT yet
 * verified is a live call against a real Willsgrove API key and billing
 * account -- see docs/milestones/PROGRESS.md's Milestone 2A section for
 * exactly what "untested" means here and why.
 *
 * `extractionResultSchema` includes the literal `schemaVersion` field, so
 * the model is asked to echo it back; zodOutputFormat renders a zod
 * `.literal()` as a single-value enum in the generated JSON schema, which
 * every provider this project might swap to is expected to honor the same
 * way real JSON Schema does -- if a future SDK/provider version doesn't,
 * that will surface as a validation failure (a FAILED ExtractionRun),
 * never a silently-accepted wrong value, because validateExtractionResult
 * is still run on the result regardless (see lib/po-intake.ts).
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionResultSchema } from "@/lib/extraction/schema";
import type { ExtractionInput, ExtractionProviderImpl, ExtractionProviderOutcome } from "@/lib/extraction/provider";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 8_192;

const EXTRACTION_INSTRUCTIONS = `You are extracting structured data from a customer purchase order document for Willsgrove Farm Enterprises, a Zimbabwean fresh-produce supplier.

Rules you must follow exactly:
- Never invent a quantity, unit, product code, customer name, price, or date. If the document does not clearly state a value, return null for that field -- do not guess, estimate, or default it.
- Preserve each order line's product description exactly as written on the document (original wording, spelling, and punctuation), even if you recognize what it probably means.
- Classify the document as one of: CUSTOMER_PO, HANDWRITTEN_LIST, CHAT_SCREENSHOT, ORDER_SHEET, PRICE_LIST, DELIVERY_NOTE, UNRELATED. Use UNRELATED for anything that is not a customer order (e.g. an invoice, a delivery note, or an unrelated document) rather than forcing it into one of the order-like categories.
- Different pack sizes or preparations of what might look like "the same" product (for example a punnet versus a per-kilogram bulk quantity versus a sliced variant) are different lines and must never be merged into one.
- Give each line a confidence between 0 and 1 reflecting how certain you are of the quantity/description pairing, and add a short warning string for anything a human reviewer should double-check (an ambiguous description, a missing quantity, unusual wording).
- Do not estimate or state a selling price. customerProvidedUnitPrice should only be filled in if the customer's own document explicitly writes a price next to a line -- otherwise leave it null.`;

function buildUserContent(input: ExtractionInput): Anthropic.Messages.MessageParam["content"] {
  if (input.kind === "text") {
    return [
      {
        type: "text",
        text: `Here is the pasted order text:\n\n${input.text}`,
      },
    ];
  }

  if (input.kind === "document") {
    return [
      {
        type: "document",
        source: { type: "base64", media_type: input.mimeType, data: input.base64Data },
      },
      { type: "text", text: "Extract this purchase order document." },
    ];
  }

  return [
    {
      type: "image",
      source: { type: "base64", media_type: input.mimeType, data: input.base64Data },
    },
    { type: "text", text: "Extract this purchase order image." },
  ];
}

export type AnthropicProviderOptions = {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
};

export class AnthropicExtractionProvider implements ExtractionProviderImpl {
  readonly providerName = "ANTHROPIC" as const;

  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async extract(input: ExtractionInput): Promise<ExtractionProviderOutcome> {
    const startedAt = Date.now();

    try {
      const message = await this.client.messages.parse({
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system: EXTRACTION_INSTRUCTIONS,
        messages: [{ role: "user", content: buildUserContent(input) }],
        output_config: {
          format: zodOutputFormat(extractionResultSchema),
        },
      });

      const processingTimeMs = Date.now() - startedAt;

      if (!message.parsed_output) {
        return {
          ok: false,
          errorMessage: "The model did not return a parseable structured response.",
          rawResponse: message,
          processingTimeMs,
        };
      }

      return {
        ok: true,
        result: message.parsed_output,
        rawResponse: message,
        model: message.model ?? this.model,
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startedAt;
      const errorMessage = error instanceof Error ? error.message : "Unknown extraction provider error.";
      return {
        ok: false,
        errorMessage,
        processingTimeMs,
      };
    }
  }
}

/**
 * Reads ANTHROPIC_API_KEY/ANTHROPIC_MODEL from the environment and
 * constructs the provider. Returns null (never throws) when no key is
 * configured, so callers (lib/extraction/router.ts) can cleanly fall back
 * to the mock provider in dev/test rather than crashing -- see
 * .env.example and SETUP-WINDOWS.md for how to set the real key.
 */
export function createAnthropicProvider(): AnthropicExtractionProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new AnthropicExtractionProvider({
    apiKey,
    model: process.env.ANTHROPIC_MODEL || undefined,
  });
}
