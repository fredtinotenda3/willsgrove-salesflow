export const MAX_JSON_BODY_CHARS = 20000;

export type JsonObjectResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string };

export async function readJsonObject(
  request: Request,
  maxChars: number = MAX_JSON_BODY_CHARS
): Promise<JsonObjectResult> {
  let text: string;

  try {
    text = await request.text();
  } catch {
    return { ok: false, message: "Unable to read the request body." };
  }

  if (text.length > maxChars) {
    return { ok: false, message: "Request body is too large." };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}