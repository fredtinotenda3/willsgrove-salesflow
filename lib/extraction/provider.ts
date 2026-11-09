/**
 * Milestone 2A. The provider-independent extraction interface (Milestone
 * 2 brief, section 3): the Anthropic provider and the mock provider
 * implement exactly this, so lib/extraction/router.ts and lib/po-intake.ts
 * never branch on which one they're talking to.
 *
 * Deterministic parsing (Excel/CSV -- lib/extraction/deterministic) is
 * deliberately NOT behind this interface: those paths never call an AI
 * provider at all (see the refinement in CHANGES.md -- "do not
 * unnecessarily send structured Excel/CSV data to an AI provider"), so
 * forcing them through an "ExtractionProviderImpl" shape would be a
 * false abstraction. lib/extraction/router.ts dispatches to one or the
 * other based on the document's channel.
 */
import type { ExtractionResult } from "@/lib/extraction/schema";

export type ExtractionInput =
  | { kind: "document"; mimeType: "application/pdf"; base64Data: string; fileName: string }
  | { kind: "image"; mimeType: "image/jpeg" | "image/png"; base64Data: string; fileName: string }
  | { kind: "text"; text: string };

export type ExtractionProviderOutcome =
  | {
      ok: true;
      result: ExtractionResult;
      rawResponse: unknown;
      model: string | null;
      processingTimeMs: number;
    }
  | {
      ok: false;
      errorMessage: string;
      rawResponse?: unknown;
      processingTimeMs: number;
    };

export interface ExtractionProviderImpl {
  readonly providerName: "ANTHROPIC" | "MOCK";
  extract(input: ExtractionInput): Promise<ExtractionProviderOutcome>;
}
