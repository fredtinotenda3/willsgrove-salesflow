import "server-only";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

// bcryptjs is a pure-JS bcrypt implementation: no native compiler toolchain,
// so it installs and runs cleanly on Windows (unlike the native `bcrypt`
// package, which needs node-gyp). It is slower per-hash than a native
// implementation, which is an acceptable trade for a login endpoint that is
// also rate-limited (see rate-limit.ts).
const SALT_ROUNDS = 12;

const MIN_PASSWORD_LENGTH = 10;

export type PasswordStrengthResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Minimum bar for a new password (seeded admin's first real password,
 * any future self-service change). Deliberately simple and explainable
 * rather than a byzantine composition rule: length is the single strongest
 * predictor of guessability, so we require a reasonable minimum length and
 * reject a handful of trivially weak values, rather than forcing a
 * particular mix of character classes.
 */
export function checkPasswordStrength(password: string): PasswordStrengthResult {
  if (typeof password !== "string") {
    return { ok: false, message: "Password is required." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password.length > 256) {
    return { ok: false, message: "Password is too long." };
  }

  const lowered = password.toLowerCase();
  const trivial = ["password", "password123", "willsgrove", "salesflow", "12345678901"];
  if (trivial.some((weak) => lowered === weak || lowered.includes(weak))) {
    return { ok: false, message: "Password is too easy to guess. Choose something less predictable." };
  }

  return { ok: true };
}

// crypto.randomInt is used (not Math.random) because this value is a
// credential, however short-lived -- it must come from a CSPRNG.
const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // excludes visually ambiguous 0/O/1/l/I

/**
 * Generates a random temporary password for an administrator-created user.
 * Always satisfies checkPasswordStrength(). The caller (app/api/users
 * route) returns this to the admin exactly once in the creation response --
 * it is never emailed (no mail integration at this milestone) and is not
 * retrievable afterward; the new user must change it at first login
 * (mustChangePassword is set true on the created row).
 */
export function generateTemporaryPassword(length = 16): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return result;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    // A malformed stored hash should never throw into the caller; treat it
    // as a failed verification instead of a 500.
    return false;
  }
}
