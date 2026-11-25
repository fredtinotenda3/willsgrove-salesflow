import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every drill-down the command centre emits must land on a real admin page (no dead links). */
const root = join(__dirname, "..");
const source = readFileSync(join(root, "lib/admin/command-centre.ts"), "utf8");
const hrefs = [...new Set([...source.matchAll(/["'`](\/admin[^"'`$ ]*)/g)].map((m) => m[1].split("?")[0].replace(/\/$/, "")))];

describe("command centre links", () => {
  it("finds the links it emits", () => expect(hrefs.length).toBeGreaterThan(8));
  for (const href of hrefs) it(`${href} is a real page`, () => expect(existsSync(join(root, "app", href, "page.tsx")), href).toBe(true));
});
