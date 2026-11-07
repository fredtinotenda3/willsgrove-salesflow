import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getStorageDriver } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/files/[id]
 *
 * Authorised download for an uploaded OrderDocument. `id` is the
 * OrderDocument row id, NOT the storage key -- the storage key never
 * appears in a URL or any client-visible value, so there is nothing for a
 * client to guess or tamper with to reach another file (see
 * lib/storage/local-disk-driver.ts for the storage-layer half of this).
 *
 * Auth note: same open scope item as the upload route -- any authenticated
 * user can download any order's documents at this milestone.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid document id." }, { status: 400 });
  }

  const document = await prisma.orderDocument.findUnique({
    where: { id },
    select: {
      storageKey: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
    },
  });

  if (!document) {
    return NextResponse.json({ success: false, message: "Document not found." }, { status: 404 });
  }

  const storage = getStorageDriver();
  const data = await storage.get(document.storageKey);

  if (!data) {
    // Metadata exists but the bytes are missing from the storage root --
    // a genuine inconsistency (manual deletion, moved STORAGE_LOCAL_DIR,
    // etc.), not a client error. Logged for operator visibility.
    console.error(`OrderDocument ${id} has no bytes at storage key ${document.storageKey}.`);
    return NextResponse.json(
      { success: false, message: "The stored file could not be found." },
      { status: 404 }
    );
  }

  const asciiFallback = document.originalFileName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(document.originalFileName);

  // Wrapped in a plain Uint8Array: @types/node's Buffer<ArrayBufferLike>
  // doesn't structurally satisfy BodyInit under strict mode, even though
  // a Buffer works fine here at runtime (it IS a Uint8Array).
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(document.fileSize),
      // Both a plain filename (for older clients) and an RFC 5987-encoded
      // one (for correct handling of non-ASCII names).
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
