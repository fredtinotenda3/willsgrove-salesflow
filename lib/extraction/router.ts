/**
 * Milestone 2A. Single dispatch point from "a document/text arrived on
 * channel X" to "here is its extraction outcome" -- the one place that
 * knows which channels are deterministic (no AI call) and which go
 * through a provider (Anthropic or mock). lib/po-intake.ts calls this and
 * nothing else; it never branches on channel itself.
 *
 * Deliberately imports OrderSource/ExtractionProvider as TYPES ONLY
 * (`import type`), never as runtime values: this module's logic is a
 * plain string-literal switch, not a Prisma query, so it has no genuine
 * need to dereference the generated client's enum objects at runtime.
 * That also means this file -- unlike anything that touches
 * lib/prisma.ts -- runs correctly against this sandbox's broken stub
 * client (which exports every enum as `undefined`; see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"), so its own
 * dispatch logic is directly unit-testable here, not just on your real
 * machine. lib/po-intake.ts is the boundary where these plain strings
 * actually reach a Prisma call.
 */
import "server-only";
import type { OrderSource, ExtractionProvider } from "@prisma/client";
import { parseCustomerPoCsv } from "@/lib/extraction/deterministic/csv";
import { parseCustomerPoExcel } from "@/lib/extraction/deterministic/excel";
import { createAnthropicProvider } from "@/lib/extraction/providers/anthropic";
import { MockExtractionProvider } from "@/lib/extraction/providers/mock";
import type { ExtractionInput } from "@/lib/extraction/provider";
import type { ExtractionResult } from "@/lib/extraction/schema";

export type ExtractionDispatchOutcome =
  | {
      ok: true;
      provider: ExtractionProvider;
      model: string | null;
      processingTimeMs: number;
      rawResponse: unknown;
      result: ExtractionResult;
    }
  | {
      ok: false;
      provider: ExtractionProvider;
      model: string | null;
      processingTimeMs: number;
      rawResponse?: unknown;
      errorMessage: string;
    };

export type DispatchExtractionParams = {
  sourceChannel: OrderSource;
  fileBuffer?: Buffer;
  pastedText?: string;
  /** Test/dev-only override for the mock provider's canned fixture. */
  mockFixtureKey?: string;
};

/**
 * Chooses the AI-backed provider: ANTHROPIC when EXTRACTION_PROVIDER is
 * not explicitly "mock" AND a real API key is configured; MOCK otherwise.
 * EXTRACTION_PROVIDER=mock forces mock even with a key present, which
 * matters for predictable demos/tests that shouldn't burn a real API
 * call. See .env.example.
 */
function selectAiProvider(mockFixtureKey?: string) {
  const forcedMock = process.env.EXTRACTION_PROVIDER === "mock";
  if (!forcedMock) {
    const anthropic = createAnthropicProvider();
    if (anthropic) return anthropic;
  }
  return new MockExtractionProvider({ fixtureKey: mockFixtureKey });
}

export async function dispatchExtraction(params: DispatchExtractionParams): Promise<ExtractionDispatchOutcome> {
  const startedAt = Date.now();

  switch (params.sourceChannel) {
    case "EXCEL": {
      if (!params.fileBuffer) {
        return {
          ok: false,
          provider: "DETERMINISTIC",
          model: null,
          processingTimeMs: Date.now() - startedAt,
          errorMessage: "No file was provided for an EXCEL upload.",
        };
      }
      const parsed = await parseCustomerPoExcel(params.fileBuffer);
      const processingTimeMs = Date.now() - startedAt;
      if (!parsed.ok) {
        return { ok: false, provider: "DETERMINISTIC", model: null, processingTimeMs, errorMessage: parsed.message };
      }
      return {
        ok: true,
        provider: "DETERMINISTIC",
        model: null,
        processingTimeMs,
        rawResponse: { deterministic: true, format: "xlsx" },
        result: parsed.result,
      };
    }

    case "CSV": {
      if (!params.fileBuffer) {
        return {
          ok: false,
          provider: "DETERMINISTIC",
          model: null,
          processingTimeMs: Date.now() - startedAt,
          errorMessage: "No file was provided for a CSV upload.",
        };
      }
      const parsed = parseCustomerPoCsv(params.fileBuffer.toString("utf-8"));
      const processingTimeMs = Date.now() - startedAt;
      if (!parsed.ok) {
        return { ok: false, provider: "DETERMINISTIC", model: null, processingTimeMs, errorMessage: parsed.message };
      }
      return {
        ok: true,
        provider: "DETERMINISTIC",
        model: null,
        processingTimeMs,
        rawResponse: { deterministic: true, format: "csv" },
        result: parsed.result,
      };
    }

    case "PDF":
    case "IMAGE": {
      if (!params.fileBuffer) {
        return {
          ok: false,
          provider: "MOCK",
          model: null,
          processingTimeMs: Date.now() - startedAt,
          errorMessage: `No file was provided for a ${params.sourceChannel} upload.`,
        };
      }
      const provider = selectAiProvider(params.mockFixtureKey);
      const input: ExtractionInput =
        params.sourceChannel === "PDF"
          ? { kind: "document", mimeType: "application/pdf", base64Data: params.fileBuffer.toString("base64"), fileName: "document.pdf" }
          : { kind: "image", mimeType: "image/jpeg", base64Data: params.fileBuffer.toString("base64"), fileName: "document.jpg" };
      const outcome = await provider.extract(input);
      const providerValue: ExtractionProvider = provider.providerName === "ANTHROPIC" ? "ANTHROPIC" : "MOCK";
      if (!outcome.ok) {
        return { ok: false, provider: providerValue, model: null, processingTimeMs: outcome.processingTimeMs, rawResponse: outcome.rawResponse, errorMessage: outcome.errorMessage };
      }
      return {
        ok: true,
        provider: providerValue,
        model: outcome.model,
        processingTimeMs: outcome.processingTimeMs,
        rawResponse: outcome.rawResponse,
        result: outcome.result,
      };
    }

    case "EMAIL":
    case "WHATSAPP": {
      if (!params.pastedText || params.pastedText.trim() === "") {
        return {
          ok: false,
          provider: "MOCK",
          model: null,
          processingTimeMs: Date.now() - startedAt,
          errorMessage: "No pasted text was provided.",
        };
      }
      const provider = selectAiProvider(params.mockFixtureKey);
      const outcome = await provider.extract({ kind: "text", text: params.pastedText });
      const providerValue: ExtractionProvider = provider.providerName === "ANTHROPIC" ? "ANTHROPIC" : "MOCK";
      if (!outcome.ok) {
        return { ok: false, provider: providerValue, model: null, processingTimeMs: outcome.processingTimeMs, rawResponse: outcome.rawResponse, errorMessage: outcome.errorMessage };
      }
      return {
        ok: true,
        provider: providerValue,
        model: outcome.model,
        processingTimeMs: outcome.processingTimeMs,
        rawResponse: outcome.rawResponse,
        result: outcome.result,
      };
    }

    case "MANUAL":
    default:
      return {
        ok: false,
        provider: "DETERMINISTIC",
        model: null,
        processingTimeMs: Date.now() - startedAt,
        errorMessage: `${params.sourceChannel} is not an extractable intake channel -- manual entry bypasses extraction entirely.`,
      };
  }
}
