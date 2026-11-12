import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Milestone 12 (Sales Performance Intelligence). A small, source-level
 * acceptance check: the central finding of this milestone's architecture
 * review was that lib/orders.ts's createOrderCore silently defaulted
 * CustomerOrder.salespersonId to the order's creator
 * (`input.salespersonId ?? createdById`), which is exactly the
 * data-integrity gap this milestone's whole attribution-confidence model
 * exists to work around. This test reads the ACTUAL file on disk and
 * fails if that fallback pattern is ever reintroduced -- a regression
 * here would silently poison every order created afterwards with a
 * false "explicit choice" signal no attribution logic could detect
 * (classifyDirectOrderAttribution relies entirely on the AuditEvent
 * record, not on re-deriving intent from the field's value, so a
 * reintroduced default would be invisible to every test in
 * tests/attribution.test.ts).
 */
describe("Milestone 12 acceptance criteria", () => {
  it("lib/orders.ts's createOrderCore no longer defaults salespersonId to createdById", () => {
    const source = readFileSync(join(process.cwd(), "lib/orders.ts"), "utf8");
    expect(source).not.toMatch(/salespersonId:\s*input\.salespersonId\s*\?\?\s*createdById/);
    // The real, current behaviour: a missing/null input value stays null.
    expect(source).toMatch(/salespersonId:\s*input\.salespersonId\s*\?\?\s*null/);
  });

  it("lib/order-validation.ts's createOrderSchema accepts an explicit salespersonId with no implicit default applied by the schema itself", () => {
    const source = readFileSync(join(process.cwd(), "lib/order-validation.ts"), "utf8");
    expect(source).toMatch(/salespersonId:\s*z\.string\(\)[^\n]*\.nullable\(\)\.optional\(\)/);
  });

  it("app/quotations/new/page.tsx no longer pre-fills the quotation form's salesperson picker to the current user", () => {
    const source = readFileSync(join(process.cwd(), "app/quotations/new/page.tsx"), "utf8");
    // Checks the actual JSX invocation, not prose -- this file's own
    // explanatory comment legitimately mentions the removed prop by name.
    expect(source).toMatch(/<NewQuotationForm\s*\/>/);
    expect(source).not.toMatch(/<NewQuotationForm[^>]*defaultSalespersonId/);
  });
});
