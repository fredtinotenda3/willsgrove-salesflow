/**
 * Milestone 2A (PO intake + extraction). Orchestrates one PO submission,
 * in either direction a document can arrive:
 *
 *  - "file": the sniffed byte signature (never a client-claimed MIME type
 *    or field) decides which OrderSource channel it is -- PDF, IMAGE
 *    (jpeg/png), EXCEL (.xlsx), or CSV. See lib/storage/content-sniff.ts,
 *    already shipped in Milestone 0 and reused unchanged here.
 *  - "paste": the caller states EMAIL or WHATSAPP explicitly, since
 *    there's no file signature to sniff; the pasted text is still stored
 *    through the same storage driver as every other document (encoded as
 *    UTF-8 bytes), so every OrderDocument row -- regardless of channel --
 *    has real stored bytes, a checksum, and a storageKey, and
 *    reExtractPoDocument can treat every channel uniformly.
 *
 * Classification is not a separate step here: for PDF/IMAGE/pasted text,
 * the extraction provider's output already includes `classification`
 * (see lib/extraction/schema.ts) -- running a second AI call just to ask
 * "what kind of document is this" before the one that already answers it
 * would be a wasted round-trip. For EXCEL/CSV, the deterministic parsers
 * default to CUSTOMER_PO (a structured spreadsheet upload has no
 * meaningful "is this actually a chat screenshot" question to ask). This
 * is a deliberate simplification versus the original Milestone 2 report,
 * which treated classification as its own stage -- see
 * docs/milestones/PROGRESS.md.
 *
 * Does NOT hold a database transaction open across the extraction call:
 * document creation is one transaction, extraction happens outside any
 * transaction (it may call an external API), and recording the
 * extraction outcome is a second, separate transaction. Holding a
 * Postgres transaction open for the duration of an external HTTP call
 * would tie up a connection and locks for however long that call takes.
 */
import "server-only";
// Type-only: this module's own logic never dereferences a Prisma enum
// object at runtime (see lib/extraction/router.ts's module comment for
// the full rationale). Every runtime value below is a plain string
// literal, which is structurally assignable to Prisma's generated
// string-literal-union field types without needing the generated
// client's enum objects to exist at runtime.
import type {
  DocumentClassification,
  DocumentIntakeStatus,
  OrderSource,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { validateUploadContent, type SniffedType } from "@/lib/storage/content-sniff";
import { sanitizeFileName } from "@/lib/http";
import { dispatchExtraction } from "@/lib/extraction/router";
import { validateExtractionResult } from "@/lib/extraction/schema";

// Same ceiling as the existing order-documents upload route
// (app/api/orders/[id]/documents/route.ts) -- generous for a scanned PO
// or invoice while still bounding the memory a single request can hold.
export const MAX_PO_INTAKE_BYTES = 20 * 1024 * 1024;

export type CreateIntakeInput =
  | { submission: "file"; file: Buffer; originalFileName: string; claimedMimeType: string }
  | { submission: "paste"; channel: "EMAIL" | "WHATSAPP"; pastedText: string };

export type CreateIntakeOptions = {
  /** Test/dev-only: forces the mock provider's canned fixture. */
  mockFixtureKey?: string;
  isDemo?: boolean;
};

export type CreateIntakeResult =
  | {
      ok: true;
      documentId: string;
      sourceChannel: OrderSource;
      status: DocumentIntakeStatus;
      classification: DocumentClassification | null;
      extraction:
        | { outcome: "succeeded"; extractionRunId: string }
        | { outcome: "failed"; extractionRunId: string; message: string };
    }
  | { ok: false; status: number; message: string };

function sniffedTypeToChannel(sniffed: SniffedType): OrderSource | null {
  switch (sniffed) {
    case "pdf":
      return "PDF";
    case "jpeg":
    case "png":
      return "IMAGE";
    case "zip-based":
      return "EXCEL";
    case "text":
      return "CSV";
    default:
      return null;
  }
}

async function storeBytes(
  bytes: Buffer,
  claimedMimeType: string
): Promise<{ ok: true; storageKey: string; fileSize: number; checksum: string; resolvedMimeType: string } | { ok: false; status: number; message: string }> {
  if (bytes.length === 0) {
    return { ok: false, status: 400, message: "The uploaded content is empty." };
  }
  if (bytes.length > MAX_PO_INTAKE_BYTES) {
    return { ok: false, status: 413, message: "Content exceeds the 20 MB upload limit." };
  }

  const sniff = validateUploadContent(bytes, claimedMimeType);
  if (!sniff.ok) {
    return { ok: false, status: 415, message: sniff.message };
  }

  const storage = getStorageDriver();
  const stored = await storage.put(bytes);
  return { ok: true, storageKey: stored.storageKey, fileSize: stored.fileSize, checksum: stored.checksum, resolvedMimeType: sniff.resolvedMimeType };
}

export async function createPoIntake(
  input: CreateIntakeInput,
  uploadedById: string,
  options: CreateIntakeOptions = {}
): Promise<CreateIntakeResult> {
  const bytes = input.submission === "file" ? input.file : Buffer.from(input.pastedText, "utf-8");
  const claimedMimeType = input.submission === "file" ? input.claimedMimeType : "text/plain";

  const stored = await storeBytes(bytes, claimedMimeType);
  if (!stored.ok) {
    return stored;
  }

  let sourceChannel: OrderSource;
  let originalFileName: string;

  if (input.submission === "file") {
    const sniffedChannel = sniffedTypeToChannel(
      // validateUploadContent already told us the content is one of the
      // allowed types; re-deriving the specific channel from the resolved
      // MIME type keeps this function from importing sniffContentType
      // directly and duplicating the byte-signature logic.
      stored.resolvedMimeType === "application/pdf"
        ? "pdf"
        : stored.resolvedMimeType === "image/jpeg"
          ? "jpeg"
          : stored.resolvedMimeType === "image/png"
            ? "png"
            : stored.resolvedMimeType.includes("spreadsheetml")
              ? "zip-based"
              : "text"
    );
    if (!sniffedChannel) {
      await getStorageDriver().delete(stored.storageKey).catch(() => {});
      return { ok: false, status: 415, message: "This file type is not supported for PO intake." };
    }
    sourceChannel = sniffedChannel;
    originalFileName = sanitizeFileName(input.originalFileName || "upload");
  } else {
    sourceChannel = input.channel === "EMAIL" ? "EMAIL" : "WHATSAPP";
    originalFileName = input.channel === "EMAIL" ? "pasted-email.txt" : "pasted-whatsapp.txt";
  }

  let documentId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.orderDocument.create({
        data: {
          uploadedById,
          documentType: "CUSTOMER_PO",
          originalFileName,
          storageKey: stored.storageKey,
          mimeType: stored.resolvedMimeType,
          fileSize: BigInt(stored.fileSize),
          checksum: stored.checksum,
          sourceChannel,
          status: "RECEIVED",
        },
        select: { id: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId: uploadedById,
          action: "PO_DOCUMENT_RECEIVED",
          entityType: "OrderDocument",
          entityId: document.id,
          afterData: {
            sourceChannel,
            originalFileName,
            mimeType: stored.resolvedMimeType,
            fileSize: stored.fileSize,
            checksum: stored.checksum,
          },
        },
      });

      return document;
    });
    documentId = created.id;
  } catch (error) {
    await getStorageDriver().delete(stored.storageKey).catch(() => {});
    console.error("PO intake document creation failed:", error);
    return { ok: false, status: 500, message: "Unable to save the uploaded document." };
  }

  return runExtraction(documentId, sourceChannel, bytes, input.submission === "paste" ? input.pastedText : undefined, uploadedById, options);
}

/**
 * Re-runs extraction for an existing document (e.g. after a provider
 * failure, or to pick up a schema fix). Reads the ORIGINAL stored bytes
 * back from the storage driver rather than trusting anything cached
 * elsewhere, and -- being an entirely new ExtractionRun row -- never
 * overwrites the previous attempt's record.
 */
export async function reExtractPoDocument(
  documentId: string,
  actorId: string,
  options: CreateIntakeOptions = {}
): Promise<CreateIntakeResult> {
  const document = await prisma.orderDocument.findUnique({
    where: { id: documentId },
    select: { id: true, storageKey: true, sourceChannel: true },
  });

  if (!document) {
    return { ok: false, status: 404, message: "Document not found." };
  }
  if (!document.sourceChannel) {
    return { ok: false, status: 400, message: "This document has no recorded source channel and cannot be re-extracted." };
  }

  const bytes = await getStorageDriver().get(document.storageKey);
  if (!bytes) {
    return { ok: false, status: 500, message: "The original document content could not be found in storage." };
  }

  const pastedText =
    document.sourceChannel === "EMAIL" || document.sourceChannel === "WHATSAPP"
      ? bytes.toString("utf-8")
      : undefined;

  return runExtraction(document.id, document.sourceChannel, bytes, pastedText, actorId, options);
}

async function runExtraction(
  documentId: string,
  sourceChannel: OrderSource,
  fileBuffer: Buffer,
  pastedText: string | undefined,
  actorId: string,
  options: CreateIntakeOptions
): Promise<CreateIntakeResult> {
  await prisma.orderDocument.update({ where: { id: documentId }, data: { status: "EXTRACTING" } });

  const outcome = await dispatchExtraction({
    sourceChannel,
    fileBuffer: pastedText === undefined ? fileBuffer : undefined,
    pastedText,
    mockFixtureKey: options.mockFixtureKey,
  });

  if (!outcome.ok) {
    const run = await prisma.$transaction(async (tx) => {
      const extractionRun = await tx.extractionRun.create({
        data: {
          documentId,
          provider: outcome.provider,
          model: outcome.model,
          promptVersion: "po-extraction-v1",
          startedAt: new Date(Date.now() - outcome.processingTimeMs),
          completedAt: new Date(),
          status: "FAILED",
          errorMessage: outcome.errorMessage,
          rawResponse: outcome.rawResponse === undefined ? undefined : (outcome.rawResponse as object),
          processingTimeMs: outcome.processingTimeMs,
          isDemo: options.isDemo ?? false,
        },
        select: { id: true },
      });

      await tx.orderDocument.update({ where: { id: documentId }, data: { status: "EXTRACTION_FAILED" } });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "PO_EXTRACTION_FAILED",
          entityType: "OrderDocument",
          entityId: documentId,
          afterData: { extractionRunId: extractionRun.id, provider: outcome.provider, errorMessage: outcome.errorMessage },
        },
      });

      return extractionRun;
    });

    return {
      ok: true,
      documentId,
      sourceChannel,
      status: "EXTRACTION_FAILED",
      classification: null,
      extraction: { outcome: "failed", extractionRunId: run.id, message: outcome.errorMessage },
    };
  }

  // Defensive re-validation: every path's result is TYPED as
  // ExtractionResult, but this is the one place that actually re-checks
  // it against the shared zod schema at runtime before it's trusted and
  // persisted -- see lib/extraction/schema.ts's module comment for why
  // this matters even for the mock/deterministic paths.
  const validated = validateExtractionResult(outcome.result);
  if (!validated.ok) {
    const run = await prisma.$transaction(async (tx) => {
      const extractionRun = await tx.extractionRun.create({
        data: {
          documentId,
          provider: outcome.provider,
          model: outcome.model,
          promptVersion: "po-extraction-v1",
          startedAt: new Date(Date.now() - outcome.processingTimeMs),
          completedAt: new Date(),
          status: "FAILED",
          errorMessage: validated.message,
          rawResponse: outcome.rawResponse as object,
          processingTimeMs: outcome.processingTimeMs,
          isDemo: options.isDemo ?? false,
        },
        select: { id: true },
      });

      await tx.orderDocument.update({ where: { id: documentId }, data: { status: "EXTRACTION_FAILED" } });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "PO_EXTRACTION_FAILED",
          entityType: "OrderDocument",
          entityId: documentId,
          afterData: { extractionRunId: extractionRun.id, provider: outcome.provider, errorMessage: validated.message },
        },
      });

      return extractionRun;
    });

    return {
      ok: true,
      documentId,
      sourceChannel,
      status: "EXTRACTION_FAILED",
      classification: null,
      extraction: { outcome: "failed", extractionRunId: run.id, message: validated.message },
    };
  }

  const result = validated.result;

  const run = await prisma.$transaction(async (tx) => {
    const extractionRun = await tx.extractionRun.create({
      data: {
        documentId,
        provider: outcome.provider,
        model: outcome.model,
        promptVersion: result.schemaVersion,
        startedAt: new Date(Date.now() - outcome.processingTimeMs),
        completedAt: new Date(),
        status: "SUCCEEDED",
        extractedHeader: result.header,
        extractedLines: result.lines,
        rawResponse: outcome.rawResponse as object,
        processingTimeMs: outcome.processingTimeMs,
        isDemo: options.isDemo ?? false,
      },
      select: { id: true },
    });

    await tx.orderDocument.update({
      where: { id: documentId },
      data: { status: "EXTRACTED", classification: result.classification },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PO_EXTRACTION_SUCCEEDED",
        entityType: "OrderDocument",
        entityId: documentId,
        afterData: {
          extractionRunId: extractionRun.id,
          provider: outcome.provider,
          classification: result.classification,
          lineCount: result.lines.length,
        },
      },
    });

    return extractionRun;
  });

  return {
    ok: true,
    documentId,
    sourceChannel,
    status: "EXTRACTED",
    classification: result.classification,
    extraction: { outcome: "succeeded", extractionRunId: run.id },
  };
}
