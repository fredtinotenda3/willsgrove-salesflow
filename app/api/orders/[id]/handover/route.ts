import { NextRequest } from "next/server";
import { z } from "zod";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { generateHandover } from "@/lib/handover/generate-handover";
import { listOrderHandovers } from "@/lib/handover/queries";

type RouteContext = { params: Promise<{ id: string }> };

const generateHandoverSchema = z.object({
  format: z.enum(["EXCEL", "CSV", "CLIPBOARD"]),
});

/**
 * Milestone 2C. GET lists every handover generated for this order so
 * far (append-only history); POST generates a new one, manually
 * triggered, in the requested format.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return Response.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  try {
    const handovers = await listOrderHandovers(id);
    return Response.json({ success: true, handovers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Handover list failed:", error);
    return Response.json({ success: false, message: "Unable to load this order's handovers." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return Response.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return Response.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = generateHandoverSchema.safeParse(body.body);
    if (!parsed.success) {
      return Response.json({ success: false, message: "format must be EXCEL, CSV, or CLIPBOARD." }, { status: 400 });
    }

    const result = await generateHandover(id, user.id, parsed.data.format);
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }

    return Response.json({ success: true, handover: result.handover }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Handover generation failed:", error);
    return Response.json({ success: false, message: "Unable to generate a handover for this order." }, { status: 500 });
  }
}
