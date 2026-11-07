import { describe, it, expect } from "vitest";
import { readJsonObject, isValidId, MAX_JSON_BODY_CHARS } from "@/lib/http";

function requestWithBody(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers,
    body,
  });
}

describe("readJsonObject", () => {
  it("accepts a valid JSON object body", async () => {
    const result = await readJsonObject(requestWithBody(JSON.stringify({ a: 1, b: "two" })));
    expect(result).toEqual({ ok: true, body: { a: 1, b: "two" } });
  });

  it("accepts an empty JSON object", async () => {
    const result = await readJsonObject(requestWithBody("{}"));
    expect(result).toEqual({ ok: true, body: {} });
  });

  it("rejects a JSON array at the top level", async () => {
    const result = await readJsonObject(requestWithBody(JSON.stringify([1, 2, 3])));
    expect(result.ok).toBe(false);
  });

  it("rejects a bare JSON primitive (string) at the top level", async () => {
    const result = await readJsonObject(requestWithBody(JSON.stringify("just a string")));
    expect(result.ok).toBe(false);
  });

  it("rejects a bare JSON primitive (number) at the top level", async () => {
    const result = await readJsonObject(requestWithBody("42"));
    expect(result.ok).toBe(false);
  });

  it("rejects JSON null at the top level", async () => {
    const result = await readJsonObject(requestWithBody("null"));
    expect(result.ok).toBe(false);
  });

  it("rejects malformed JSON", async () => {
    const result = await readJsonObject(requestWithBody("{not valid json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/valid JSON/i);
    }
  });

  it("rejects an empty body as malformed JSON rather than throwing", async () => {
    const result = await readJsonObject(requestWithBody(""));
    expect(result.ok).toBe(false);
  });

  it("rejects a body longer than the default max length", async () => {
    const huge = JSON.stringify({ value: "x".repeat(MAX_JSON_BODY_CHARS + 1) });
    const result = await readJsonObject(requestWithBody(huge));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/too large/i);
    }
  });

  it("honors a custom maxChars override", async () => {
    const body = JSON.stringify({ a: 1 });
    // The body easily fits under the default limit but not under a very
    // small custom one.
    const result = await readJsonObject(requestWithBody(body), 5);
    expect(result.ok).toBe(false);
  });

  it("accepts a body that fits exactly under a custom maxChars", async () => {
    const body = JSON.stringify({ a: 1 });
    const result = await readJsonObject(requestWithBody(body), body.length);
    expect(result).toEqual({ ok: true, body: { a: 1 } });
  });

  it("returns a graceful error instead of throwing when the body stream errors", async () => {
    const failingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("simulated network interruption"));
      },
    });
    const request = new Request("http://localhost/test", {
      method: "POST",
      // @ts-expect-error -- duplex is required by undici for streaming bodies but missing from the DOM lib types used here
      duplex: "half",
      body: failingBody,
    });

    const result = await readJsonObject(request);
    expect(result.ok).toBe(false);
  });
});

describe("isValidId", () => {
  it("accepts alphanumeric ids with underscores and hyphens", () => {
    expect(isValidId("abc123")).toBe(true);
    expect(isValidId("a-b_c-123")).toBe(true);
  });

  it("accepts a single character id", () => {
    expect(isValidId("a")).toBe(true);
  });

  it("accepts an id exactly at the 64-character limit", () => {
    expect(isValidId("a".repeat(64))).toBe(true);
  });

  it("rejects an id over the 64-character limit", () => {
    expect(isValidId("a".repeat(65))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidId("")).toBe(false);
  });

  it("rejects ids containing path separators (path traversal attempt)", () => {
    expect(isValidId("../../etc/passwd")).toBe(false);
    expect(isValidId("a/b")).toBe(false);
  });

  it("rejects ids containing whitespace", () => {
    expect(isValidId("abc 123")).toBe(false);
  });

  it("rejects ids containing special characters", () => {
    expect(isValidId("abc;123")).toBe(false);
    expect(isValidId("<script>")).toBe(false);
    expect(isValidId("abc.json")).toBe(false);
  });
});
