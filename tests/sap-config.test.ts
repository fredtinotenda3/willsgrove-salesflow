import { describe, it, expect, afterEach } from "vitest";
import {
  getSapDeploymentMode,
  resolveSapLiveCredentials,
  canUseLiveSapAdapter,
  sanitizeSapErrorMessage,
} from "@/lib/integrations/sap/config";

/**
 * Milestone 9 (SAP Business One Integration). Unit tests for the
 * deployment-mode/credential-resolution gate. Pure -- config.ts imports
 * only "server-only" (which resolves to a no-op under vitest.config.mts's
 * `conditions: ["react-server"]`) and reads `process.env`, never
 * lib/prisma -- so these run unconditionally under `npm test`.
 */

const ENV_KEYS = ["SAP_B1_PROVIDER", "SAP_B1_PASSWORD"] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const COMPLETE_CONNECTION = { baseUrl: "https://b1.example.com:50000/b1s/v1", companyDb: "WILLSGROVE_PROD", username: "svc-salesflow" };

describe("getSapDeploymentMode", () => {
  it("defaults to 'mock' when SAP_B1_PROVIDER is unset", () => {
    delete process.env.SAP_B1_PROVIDER;
    expect(getSapDeploymentMode()).toBe("mock");
  });

  it("is 'live' only for the exact, case-sensitive string 'live'", () => {
    process.env.SAP_B1_PROVIDER = "live";
    expect(getSapDeploymentMode()).toBe("live");
  });

  it("fails safe to 'mock' on a typo or any other value", () => {
    process.env.SAP_B1_PROVIDER = "Live";
    expect(getSapDeploymentMode()).toBe("mock");
    process.env.SAP_B1_PROVIDER = "LIVE";
    expect(getSapDeploymentMode()).toBe("mock");
    process.env.SAP_B1_PROVIDER = "enabled";
    expect(getSapDeploymentMode()).toBe("mock");
  });
});

describe("resolveSapLiveCredentials", () => {
  it("returns null when SAP_B1_PASSWORD is not set, even with a complete connection row", () => {
    delete process.env.SAP_B1_PASSWORD;
    expect(resolveSapLiveCredentials(COMPLETE_CONNECTION)).toBeNull();
  });

  it("returns null when any of baseUrl/companyDb/username is missing", () => {
    process.env.SAP_B1_PASSWORD = "secret";
    expect(resolveSapLiveCredentials({ ...COMPLETE_CONNECTION, baseUrl: null })).toBeNull();
    expect(resolveSapLiveCredentials({ ...COMPLETE_CONNECTION, companyDb: null })).toBeNull();
    expect(resolveSapLiveCredentials({ ...COMPLETE_CONNECTION, username: null })).toBeNull();
  });

  it("returns the full credential set only when everything, including the env password, is present", () => {
    process.env.SAP_B1_PASSWORD = "secret";
    expect(resolveSapLiveCredentials(COMPLETE_CONNECTION)).toEqual({ ...COMPLETE_CONNECTION, password: "secret" });
  });
});

describe("canUseLiveSapAdapter", () => {
  it("is false when the deployment mode is mock, even with complete credentials", () => {
    delete process.env.SAP_B1_PROVIDER;
    process.env.SAP_B1_PASSWORD = "secret";
    expect(canUseLiveSapAdapter(COMPLETE_CONNECTION)).toBe(false);
  });

  it("is false when the mode is live but credentials are incomplete", () => {
    process.env.SAP_B1_PROVIDER = "live";
    delete process.env.SAP_B1_PASSWORD;
    expect(canUseLiveSapAdapter(COMPLETE_CONNECTION)).toBe(false);
  });

  it("is true only when BOTH the env mode is 'live' AND credentials are complete", () => {
    process.env.SAP_B1_PROVIDER = "live";
    process.env.SAP_B1_PASSWORD = "secret";
    expect(canUseLiveSapAdapter(COMPLETE_CONNECTION)).toBe(true);
  });
});

describe("sanitizeSapErrorMessage", () => {
  it("redacts an exact password or username match wherever it appears in the message", () => {
    const message = "Login failed for svc-salesflow with password Sup3rSecret!";
    const sanitized = sanitizeSapErrorMessage(message, { password: "Sup3rSecret!", username: "svc-salesflow" });
    expect(sanitized).not.toContain("Sup3rSecret!");
    expect(sanitized).not.toContain("svc-salesflow");
    expect(sanitized).toContain("[REDACTED]");
  });

  it("redacts an Authorization header and a Bearer token even with no credentials supplied", () => {
    const message = "Request failed. Authorization: Basic dXNlcjpwYXNz Bearer abc123.def456-ghi";
    const sanitized = sanitizeSapErrorMessage(message);
    expect(sanitized).not.toContain("dXNlcjpwYXNz");
    expect(sanitized).not.toContain("abc123.def456-ghi");
    expect(sanitized).toContain("Authorization: [REDACTED]");
    expect(sanitized).toContain("Bearer [REDACTED]");
  });

  it("truncates an overly long message to 500 characters plus an ellipsis", () => {
    const sanitized = sanitizeSapErrorMessage("x".repeat(1000));
    expect(sanitized.length).toBe(501);
    expect(sanitized.endsWith("…")).toBe(true);
  });

  it("passes through an ordinary message unchanged", () => {
    expect(sanitizeSapErrorMessage("Item code ITM-9999 not found")).toBe("Item code ITM-9999 not found");
  });
});
