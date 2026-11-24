import "server-only";
import { NextRequest } from "next/server";
import type { z } from "zod";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { isValidId, readJsonObject } from "@/lib/http";
import type { AdminFailure } from "./types";

/**
 * Every /api/admin mutation goes through here, so the order is identical and
 * cannot be forgotten on one route: CSRF origin check -> session -> ADMINISTRATOR
 * role (re-read from the database by requireUserOrResponse, not trusted from the
 * cookie or the UI) -> bounded JSON body -> zod validation.
 */
export async function adminMutation<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
  handler: (input: z.infer<S>, actor: AuthenticatedUser) => Promise<Response>
): Promise<Response> {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) return Response.json({ success: false, message: csrf.message }, { status: 403 });
  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(request, 200000);
  if (!body.ok) return Response.json({ success: false, message: body.message }, { status: 400 });
  const parsed = schema.safeParse(body.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
    return Response.json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid request.", fieldErrors }, { status: 400 });
  }
  try {
    return await handler(parsed.data, auth.user);
  } catch (error) {
    // Never echo internals (or secrets) to the client; the server log carries the error.
    console.error("[admin] mutation failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ success: false, message: "The operation failed. Nothing was changed." }, { status: 500 });
  }
}

export async function adminRead(handler: (actor: AuthenticatedUser) => Promise<Response>): Promise<Response> {
  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  return handler(auth.user);
}

export function failure(result: AdminFailure): Response {
  return Response.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
}

export function ok(extra: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, ...extra });
}

export async function routeId(context: { params: Promise<{ id: string }> }): Promise<string | null> {
  const { id } = await context.params;
  return isValidId(id) ? id : null;
}

export const invalidId = () => Response.json({ success: false, message: "Invalid id." }, { status: 400 });
