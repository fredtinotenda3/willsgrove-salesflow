import { NextRequest } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createPoIntake, MAX_PO_INTAKE_BYTES } from "@/lib/po-intake";
import { listPoIntakeDocuments } from "@/lib/po-intake-queries";

/**
 * GET /api/po-intake -- recent intake documents (read-only; Milestone 2B
 * adds the review workspace this feeds into).
 */
export async function GET() {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const documents = await listPoIntakeDocuments();
    return Response.json({ success: true, documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("PO intake list failed:", error);
    return Response.json({ success: false, message: "Unable to load PO intake documents." }, { status: 500 });
  }
}

/**
 * POST /api/po-intake -- one PO submission, either:
 *  - multipart/form-data with a "file" field (PDF/image/.xlsx/.csv --
 *    the actual channel is derived from the file's real content, never
 *    trusted from the client; see lib/po-intake.ts), or
 *  - application/json with { channel: "EMAIL" | "WHATSAPP", pastedText }
 *    for pasted message content.
 *
 * Runs extraction synchronously as part of this request -- a stated
 * Milestone 2A limitation, not an oversight: there is no background job
 * queue yet, so a slow provider call holds the HTTP request open for its
 * duration. See docs/milestones/PROGRESS.md.
 */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const contentLengthHeader = request.headers.get("content-length");
      if (contentLengthHeader && Number(contentLengthHeader) > MAX_PO_INTAKE_BYTES) {
        return Response.json({ success: false, message: "File exceeds the 20 MB upload limit." }, { status: 413 });
      }

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return Response.json(
          { success: false, message: "Expected multipart/form-data with a 'file' field." },
          { status: 400 }
        );
      }

      const file = formData.get("file");
      if (!(file instanceof File)) {
        return Response.json({ success: false, message: "Missing 'file' field." }, { status: 400 });
      }
      if (file.size === 0) {
        return Response.json({ success: false, message: "The uploaded file is empty." }, { status: 400 });
      }
      if (file.size > MAX_PO_INTAKE_BYTES) {
        return Response.json({ success: false, message: "File exceeds the 20 MB upload limit." }, { status: 413 });
      }

      // Dev/test-only affordance: picks which canned mock-provider
      // fixture a PDF/image upload gets, when EXTRACTION_PROVIDER=mock or
      // no ANTHROPIC_API_KEY is configured. Harmless in any environment --
      // it can only select among fixed, non-destructive canned responses,
      // never bypass auth, CSRF, or validation.
      const mockFixtureKeyRaw = formData.get("mockFixtureKey");
      const mockFixtureKey = typeof mockFixtureKeyRaw === "string" ? mockFixtureKeyRaw : undefined;

      const buffer = Buffer.from(await file.arrayBuffer());

      const result = await createPoIntake(
        {
          submission: "file",
          file: buffer,
          originalFileName: file.name || "upload",
          claimedMimeType: file.type || "application/octet-stream",
        },
        user.id,
        { mockFixtureKey }
      );

      if (!result.ok) {
        return Response.json({ success: false, message: result.message }, { status: result.status });
      }

      return Response.json({ success: true, ...result }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    const body: unknown = await request.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return Response.json({ success: false, message: "Request body must be a JSON object." }, { status: 400 });
    }

    const { channel, pastedText, mockFixtureKey } = body as Record<string, unknown>;

    if (channel !== "EMAIL" && channel !== "WHATSAPP") {
      return Response.json({ success: false, message: 'channel must be "EMAIL" or "WHATSAPP".' }, { status: 400 });
    }
    if (typeof pastedText !== "string" || pastedText.trim() === "") {
      return Response.json({ success: false, message: "pastedText is required." }, { status: 400 });
    }
    if (pastedText.length > MAX_PO_INTAKE_BYTES) {
      return Response.json({ success: false, message: "Pasted text exceeds the upload size limit." }, { status: 413 });
    }

    const result = await createPoIntake(
      { submission: "paste", channel, pastedText },
      user.id,
      { mockFixtureKey: typeof mockFixtureKey === "string" ? mockFixtureKey : undefined }
    );

    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }

    return Response.json({ success: true, ...result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("PO intake create failed:", error);
    return Response.json({ success: false, message: "Unable to process this PO submission." }, { status: 500 });
  }
}
