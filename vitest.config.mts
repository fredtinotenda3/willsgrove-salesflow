import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
    // Matches how Next.js's own bundler resolves the `server-only`
    // marker package (its package.json `exports` map only special-cases
    // the "react-server" condition; everything else gets the throwing
    // index.js). Without this, every lib/auth/* and lib/storage/* module
    // -- all legitimately marked server-only -- would throw immediately
    // on import under plain Vitest.
    conditions: ["react-server"],
  },
  ssr: {
    resolve: {
      conditions: ["react-server"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Most of these tests set process.env vars (APP_BASE_URL, etc.);
    // running test files in their own isolated process pools prevents one
    // file's env mutation from leaking into another.
    isolate: true,
    // lib/auth/password.ts uses bcryptjs (pure-JS, no native compiler
    // toolchain -- chosen so it installs cleanly on Windows) at a
    // deliberately real-world bcrypt cost factor (12 rounds). That cost
    // factor is a security choice and should not be weakened just to make
    // tests faster; a single hash+verify round trip has been observed to
    // take just over Vitest's 5000ms default on slower hardware, which
    // failed the test on a timeout rather than an assertion. Raised here,
    // once, for every test, instead of lowering the real cost factor.
    testTimeout: 20000,
  },
});
