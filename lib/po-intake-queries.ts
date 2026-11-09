/**
 * Milestone 2A. Read-only queries for the PO intake list/detail views --
 * kept separate from lib/po-intake.ts (which only ever creates/mutates),
 * the same split this project already uses for orders
 * (lib/orders.ts vs lib/order-queries.ts).
 */
import "server-only";
import { prisma } from "@/lib/prisma";

export type PoIntakeListItem = {
  id: string;
  originalFileName: string;
  sourceChannel: string | null;
  classification: string | null;
  status: string;
  fileSize: number;
  createdAt: Date;
  uploadedBy: { id: string; name: string };
};

export async function listPoIntakeDocuments(limit = 50): Promise<PoIntakeListItem[]> {
  const documents = await prisma.orderDocument.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true,
      originalFileName: true,
      sourceChannel: true,
      classification: true,
      status: true,
      fileSize: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
  });

  return documents.map((document) => ({
    id: document.id,
    originalFileName: document.originalFileName,
    sourceChannel: document.sourceChannel,
    classification: document.classification,
    status: document.status,
    fileSize: Number(document.fileSize),
    createdAt: document.createdAt,
    uploadedBy: document.uploadedBy,
  }));
}

export type PoIntakeExtractionRunSummary = {
  id: string;
  provider: string;
  model: string | null;
  promptVersion: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  processingTimeMs: number | null;
  errorMessage: string | null;
  extractedHeader: unknown;
  extractedLines: unknown;
};

export type PoIntakeDocumentDetail = {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  sourceChannel: string | null;
  classification: string | null;
  status: string;
  createdAt: Date;
  uploadedBy: { id: string; name: string };
  // Newest first -- the Milestone 2 brief requires every original
  // extraction attempt to stay visible, not just the latest.
  extractionRuns: PoIntakeExtractionRunSummary[];
};

export async function getPoIntakeDocumentDetail(documentId: string): Promise<PoIntakeDocumentDetail | null> {
  const document = await prisma.orderDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      sourceChannel: true,
      classification: true,
      status: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
      extractionRuns: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          provider: true,
          model: true,
          promptVersion: true,
          status: true,
          startedAt: true,
          completedAt: true,
          processingTimeMs: true,
          errorMessage: true,
          extractedHeader: true,
          extractedLines: true,
        },
      },
    },
  });

  if (!document) return null;

  return {
    id: document.id,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    fileSize: Number(document.fileSize),
    sourceChannel: document.sourceChannel,
    classification: document.classification,
    status: document.status,
    createdAt: document.createdAt,
    uploadedBy: document.uploadedBy,
    extractionRuns: document.extractionRuns,
  };
}
