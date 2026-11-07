import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";

const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL;

describe("verifyCsrfOrigin", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env.APP_BASE_URL = ORIGINAL_APP_BASE_URL;
  });

  it("accepts a matching Origin header", () => {
    const request = new Request("http://localhost:3000/api/customers", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });

    expect(verifyCsrfOrigin(request)).toEqual({ ok: true });
  });

  it("rejects a cross-site Origin header", () => {
    const request = new Request("http://localhost:3000/api/customers", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });

    const result = verifyCsrfOrigin(request);
    expect(result.ok).toBe(false);
  });

  it("falls back to a matching Referer when Origin is absent", () => {
    const request = new Request("http://localhost:3000/api/customers", {
      method: "POST",
      headers: { referer: "http://localhost:3000/orders/new" },
    });

    expect(verifyCsrfOrigin(request)).toEqual({ ok: true });
  });

  it("rejects a cross-site Referer when Origin is absent", () => {
    const request = new Request("http://localhost:3000/api/customers", {
      method: "POST",
      headers: { referer: "https://evil.example.com/phish" },
    });

    const result = verifyCsrfOrigin(request);
    expect(result.ok).toBe(false);
  });

  it("rejects a request with neither Origin nor Referer", () => {
    const request = new Request("http://localhost:3000/api/customers", {
      method: "POST",
    });

    const result = verifyCsrfOrigin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Origin or Referer/i);
    }
  });

  it("rejects a malformed Referer header", () => {
    const request = new Request("http://localhost:3000/api/customers", {
      method: "POST",
      headers: { referer: "not a url" },
    });

    expect(verifyCsrfOrigin(request).ok).toBe(false);
  });

  it("fails closed when APP_BASE_URL is not set", () => {
    delete process.env.APP_BASE_URL;

    const request = new Request("http://localhost:3000/api/customers", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });

    const result = verifyCsrfOrigin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/misconfigured/i);
    }
  });
});
