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
  },
});
