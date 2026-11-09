/**
 * Milestone 2B. Materializes (the first time) and reads (every time) the
 * review workspace for one PO intake document: the extracted header, the
 * computed/human customer match, and one ExtractedOrderLine per
 * extracted line with its own computed/human product match -- the "real
 * ExtractedOrderLine-style row" Milestone 2A's own ExtractionRun comment
 * already signposted as this milestone's job.
 *
 * Idempotent materialization: if ExtractedOrderLine rows already exist
 * for the latest successful ExtractionRun, this never recreates or
 * re-scores them -- a human may already be partway through reviewing
 * (or have already confirmed) this exact set of lines, and silently
 * re-running the matcher out from under them would discard any
 * in-progress review state. Re-extraction (lib/po-intake.ts's
 * reExtractPoDocument) creates a NEW ExtractionRun, which gets its own,
 * separate materialization here -- the old run's ExtractedOrderLine rows
 * are untouched.
 */
import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/orders";
import { extractionHeaderSchema, extractionLineSchema, type ExtractionHeader } from "@/lib/extraction/schema";
import { matchCustomerHeader, type CustomerMatchCandidate } from "@/lib/matching/customer-matcher";
import { matchProductDescription, type ProductMatchCandidate } from "@/lib/matching/product-matcher";
import { checkForDuplicates, type DuplicateWarning } from "@/lib/review/duplicate-check";

const extractedLinesArraySchema = z.array(extractionLineSchema);

export type ReviewSessionLine = {
  id: string;
  lineNumber: number;
  originalDescription: string;
  extractedQuantity: string | null;
  extractedUnit: string | null;
  customerProvidedUnitPrice: string | null;
  extractionConfidence: number | null;
  extractionWarnings: string[];
  matchedProductId: string | null;
  matchedProduct: { id: string; sapItemCode: string; itemName: string } | null;
  matchConfidence: number | null;
  matchSource: "NONE" | "ALIAS" | "FUZZY" | "MANUAL";
  matchCandidates: ProductMatchCandidate[];
  status: "PENDING" | "ACCEPTED" | "EXCLUDED";
};

export type ReviewSession = {
  documentId: string;
  extractionRunId: string;
  alreadyConfirmed: boolean;
  confirmedOrderId: string | null;
  confirmedOrderReference: string | null;
  header: ExtractionHeader;
  customerMatch: {
    matchedCustomerId: string | null;
    matchedCustomer: CustomerMatchCandidate | null;
    matchConfidence: number | null;
    matchSource: "NONE" | "ALIAS" | "FUZZY";
    candidates: CustomerMatchCandidate[];
  };
  lines: ReviewSessionLine[];
  duplicateWarnings: DuplicateWarning[];
};

export type BuildReviewSessionResult = { ok: true; session: ReviewSession } | { ok: false; status: number; message: string };

function toWarningsArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toCandidatesArray(value: unknown): ProductMatchCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ProductMatchCandidate =>
      typeof item === "object" && item !== null && "productId" in item && "sapItemCode" in item && "itemName" in item && "score" in item
  );
}

export async function getOrBuildReviewSession(documentId: string): Promise<BuildReviewSessionResult> {
  const document = await prisma.orderDocument.findUnique({
    where: { id: documentId },
    select: { id: true, checksum: true, orderId: true, order: { select: { id: true, reference: true } } },
  });
  if (!document) {
    return { ok: false, status: 404, message: "Document not found." };
  }

  const extractionRun = await prisma.extractionRun.findFirst({
    where: { documentId, status: "SUCCEEDED" },
    orderBy: { startedAt: "desc" },
    select: { id: true, extractedHeader: true, extractedLines: true },
  });
  if (!extractionRun) {
    return {
      ok: false,
      status: 400,
      message: "This document has no successful extraction yet. Wait for extraction to finish, or re-extract it, before opening the review workspace.",
    };
  }

  const headerParsed = extractionHeaderSchema.safeParse(extractionRun.extractedHeader);
  if (!headerParsed.success) {
    return { ok: false, status: 500, message: "The stored extraction header is invalid or corrupted." };
  }
  const header = headerParsed.data;

  const linesParsed = extractedLinesArraySchema.safeParse(extractionRun.extractedLines ?? []);
  if (!linesParsed.success) {
    return { ok: false, status: 500, message: "The stored extraction lines are invalid or corrupted." };
  }
  const extractedLines = linesParsed.data;

  // Customer match is never cached on the run/lines -- always computed
  // fresh so it reflects the latest Customer/CustomerAlias data, and
  // reused below for every line's (customer-scoped) product match.
  const customerMatch = await matchCustomerHeader(header.customerNameRaw, header.storeOrBranchRaw);

  let materializedLines = await prisma.extractedOrderLine.findMany({
    where: { extractionRunId: extractionRun.id },
    orderBy: { lineNumber: "asc" },
    include: { matchedProduct: { select: { id: true, sapItemCode: true, itemName: true } } },
  });

  if (materializedLines.length === 0 && extractedLines.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const line of extractedLines) {
          const productMatch = await matchProductDescription(line.originalDescription, customerMatch.matchedCustomerId);
          await tx.extractedOrderLine.create({
            data: {
              extractionRunId: extractionRun.id,
              lineNumber: line.lineNumber,
              originalDescription: line.originalDescription,
              extractedQuantity: line.extractedQuantity != null ? new Prisma.Decimal(line.extractedQuantity) : null,
              extractedUnit: line.extractedUnit,
              customerProvidedUnitPrice: line.customerProvidedUnitPrice != null ? new Prisma.Decimal(line.customerProvidedUnitPrice) : null,
              extractionConfidence: line.confidence,
              extractionWarnings: line.warnings,
              matchedProductId: productMatch.matchedProductId,
              matchConfidence: productMatch.matchConfidence,
              matchSource: productMatch.matchSource,
              matchCandidates: productMatch.candidates,
            },
          });
        }
      });
    } catch (error) {
      // Lost a race with a concurrent first-open of the same review
      // workspace -- the unique (extractionRunId, lineNumber) constraint
      // caught it; fall through and re-read what the winner created,
      // rather than treating this as a real failure.
      if (!isUniqueViolation(error)) throw error;
    }

    materializedLines = await prisma.extractedOrderLine.findMany({
      where: { extractionRunId: extractionRun.id },
      orderBy: { lineNumber: "asc" },
      include: { matchedProduct: { select: { id: true, sapItemCode: true, itemName: true } } },
    });
  }

  const duplicateWarnings = document.orderId
    ? []
    : await checkForDuplicates({
        documentId: document.id,
        documentChecksum: document.checksum,
        customerId: customerMatch.matchedCustomerId,
        customerPoReference: header.customerPoNumber,
      });

  const matchedCustomer = customerMatch.candidates.find((candidate) => candidate.customerId === customerMatch.matchedCustomerId) ?? null;

  return {
    ok: true,
    session: {
      documentId: document.id,
      extractionRunId: extractionRun.id,
      alreadyConfirmed: document.orderId !== null,
      confirmedOrderId: document.order?.id ?? null,
      confirmedOrderReference: document.order?.reference ?? null,
      header,
      customerMatch: {
        matchedCustomerId: customerMatch.matchedCustomerId,
        matchedCustomer,
        matchConfidence: customerMatch.matchConfidence,
        matchSource: customerMatch.matchSource,
        candidates: customerMatch.candidates,
      },
      lines: materializedLines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        originalDescription: line.originalDescription,
        extractedQuantity: line.extractedQuantity?.toString() ?? null,
        extractedUnit: line.extractedUnit,
        customerProvidedUnitPrice: line.customerProvidedUnitPrice?.toString() ?? null,
        extractionConfidence: line.extractionConfidence,
        extractionWarnings: toWarningsArray(line.extractionWarnings),
        matchedProductId: line.matchedProductId,
        matchedProduct: line.matchedProduct,
        matchConfidence: line.matchConfidence,
        matchSource: line.matchSource,
        matchCandidates: toCandidatesArray(line.matchCandidates),
        status: line.status,
      })),
      duplicateWarnings,
    },
  };
}
