import { describe, it, expect } from "vitest";
import {
  checkPasswordStrength,
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";

describe("checkPasswordStrength", () => {
  it("rejects passwords shorter than 10 characters", () => {
    expect(checkPasswordStrength("short1").ok).toBe(false);
  });

  it("rejects known-trivial passwords regardless of case", () => {
    expect(checkPasswordStrength("Password123").ok).toBe(false);
    expect(checkPasswordStrength("WILLSGROVE1").ok).toBe(false);
  });

  it("rejects passwords over 256 characters", () => {
    expect(checkPasswordStrength("a".repeat(257)).ok).toBe(false);
  });

  it("accepts a reasonable, non-trivial password", () => {
    expect(checkPasswordStrength("Correct-Horse-Battery-42").ok).toBe(true);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips a password through hash and verify", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-42");
    expect(await verifyPassword("Correct-Horse-Battery-42", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same-input-password-1");
    const b = await hashPassword("same-input-password-1");
    expect(a).not.toBe(b);
  });

  it("treats a malformed stored hash as a failed verification, not a throw", async () => {
    await expect(verifyPassword("anything", "not-a-real-bcrypt-hash")).resolves.toBe(false);
  });
});

describe("generateTemporaryPassword", () => {
  it("always produces a password that passes checkPasswordStrength", () => {
    for (let i = 0; i < 20; i++) {
      const password = generateTemporaryPassword();
      expect(checkPasswordStrength(password).ok).toBe(true);
    }
  });

  it("never includes visually ambiguous characters (0/O/1/l/I)", () => {
    const password = generateTemporaryPassword(200);
    expect(password).not.toMatch(/[0O1lI]/);
  });

  it("generates distinct values across calls", () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).not.toBe(b);
  });
});
