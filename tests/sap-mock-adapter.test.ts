import { describe, it, expect, beforeEach } from "vitest";
import {
  MockSapAdapter,
  resetMockSapAdapterState,
  MOCK_PRODUCTS,
  MOCK_CUSTOMERS,
} from "@/lib/integrations/sap/mock-adapter";
import { SapAdapterError, type SapSalesOrderSubmission } from "@/lib/integrations/sap/types";

/**
 * Milestone 9 (SAP Business One Integration). Unit tests for the mock
 * adapter -- pure, no `@prisma/client`/database involvement at all
 * (lib/integrations/sap/mock-adapter.ts imports no "server-only" and no
 * lib/prisma), so these run unconditionally under `npm test`, unlike
 * this milestone's DB-integration tests.
 */

function baseSubmission(overrides: Partial<SapSalesOrderSubmission> = {}): SapSalesOrderSubmission {
  return {
    idempotencyKey: "SAP-SO-test-order-1",
    customerOrderReference: "ORD-TEST-0001",
    sapCustomerCode: MOCK_CUSTOMERS[0]!.customerCode,
    currency: "USD",
    documentDate: "2026-11-11",
    lines: [{ lineNumber: 1, sapItemCode: MOCK_PRODUCTS[0]!.sapItemCode, quantity: "10", unitPrice: "5.0000" }],
    ...overrides,
  };
}

describe("MockSapAdapter", () => {
  beforeEach(() => {
    resetMockSapAdapterState();
  });

  it("testConnection/getConnectionHealth always report ok, with no network call", async () => {
    const adapter = new MockSapAdapter();
    const health = await adapter.testConnection();
    expect(health.ok).toBe(true);
    const cached = await adapter.getConnectionHealth();
    expect(cached.ok).toBe(true);
  });

  it("fetchProducts/fetchCustomers return the fixed fixture catalogue", async () => {
    const adapter = new MockSapAdapter();
    const products = await adapter.fetchProducts();
    const customers = await adapter.fetchCustomers();
    expect(products).toEqual(MOCK_PRODUCTS);
    expect(customers).toEqual(MOCK_CUSTOMERS);
  });

  it("fetchInvoices/fetchCreditNotes filter by `since` when provided", async () => {
    const adapter = new MockSapAdapter();
    const allInvoices = await adapter.fetchInvoices();
    expect(allInvoices.length).toBeGreaterThan(0);

    const future = new Date("2099-01-01");
    const filtered = await adapter.fetchInvoices(future);
    expect(filtered.length).toBe(0);
  });

  it("createSalesOrder succeeds for a valid submission against known fixture codes", async () => {
    const adapter = new MockSapAdapter();
    const result = await adapter.createSalesOrder(baseSubmission());
    expect(result.sapDocEntry).toBeTruthy();
    expect(result.sapDocNum).toContain(result.sapDocEntry);
  });

  it("is idempotent: resubmitting the same idempotencyKey returns the SAME document, never creates a second one", async () => {
    const adapter = new MockSapAdapter();
    const submission = baseSubmission();
    const first = await adapter.createSalesOrder(submission);
    const second = await adapter.createSalesOrder(submission);
    expect(second).toEqual(first);
  });

  it("rejects an unknown customer code with MISSING_CUSTOMER_MAPPING", async () => {
    const adapter = new MockSapAdapter();
    await expect(adapter.createSalesOrder(baseSubmission({ sapCustomerCode: "NO-SUCH-CUSTOMER" }))).rejects.toMatchObject({
      category: "MISSING_CUSTOMER_MAPPING",
    });
  });

  it("rejects an unknown product code with MISSING_PRODUCT_MAPPING", async () => {
    const adapter = new MockSapAdapter();
    const submission = baseSubmission({ lines: [{ lineNumber: 1, sapItemCode: "NO-SUCH-ITEM", quantity: "1", unitPrice: "1" }] });
    await expect(adapter.createSalesOrder(submission)).rejects.toMatchObject({ category: "MISSING_PRODUCT_MAPPING" });
  });

  it("rejects a non-positive quantity with INVALID_QUANTITY", async () => {
    const adapter = new MockSapAdapter();
    const submission = baseSubmission({
      lines: [{ lineNumber: 1, sapItemCode: MOCK_PRODUCTS[0]!.sapItemCode, quantity: "0", unitPrice: "1" }],
    });
    await expect(adapter.createSalesOrder(submission)).rejects.toMatchObject({ category: "INVALID_QUANTITY" });
  });

  it("rejects a negative price with INVALID_PRICE", async () => {
    const adapter = new MockSapAdapter();
    const submission = baseSubmission({
      lines: [{ lineNumber: 1, sapItemCode: MOCK_PRODUCTS[0]!.sapItemCode, quantity: "1", unitPrice: "-5" }],
    });
    await expect(adapter.createSalesOrder(submission)).rejects.toMatchObject({ category: "INVALID_PRICE" });
  });

  it("__SIMULATE_NETWORK_DOWN__ throws NETWORK_UNAVAILABLE and records nothing", async () => {
    const adapter = new MockSapAdapter();
    const submission = baseSubmission({ customerOrderReference: "ORD-TEST-0002 __SIMULATE_NETWORK_DOWN__" });
    await expect(adapter.createSalesOrder(submission)).rejects.toMatchObject({ category: "NETWORK_UNAVAILABLE" });

    const found = await adapter.findSalesOrderByExternalReference(submission.idempotencyKey);
    expect(found).toBeNull();
  });

  it("__SIMULATE_UNCERTAIN_LOST__ throws TIMEOUT and records nothing -- reconciliation correctly finds nothing", async () => {
    const adapter = new MockSapAdapter();
    const submission = baseSubmission({ customerOrderReference: "ORD-TEST-0003 __SIMULATE_UNCERTAIN_LOST__" });
    await expect(adapter.createSalesOrder(submission)).rejects.toMatchObject({ category: "TIMEOUT" });

    const found = await adapter.findSalesOrderByExternalReference(submission.idempotencyKey);
    expect(found).toBeNull();
  });

  it("__SIMULATE_TIMEOUT__ throws TIMEOUT but the order IS recorded -- the critical lost-response scenario (spec 7.2)", async () => {
    const adapter = new MockSapAdapter();
    const submission = baseSubmission({ customerOrderReference: "ORD-TEST-0004 __SIMULATE_TIMEOUT__" });

    await expect(adapter.createSalesOrder(submission)).rejects.toMatchObject({ category: "TIMEOUT" });

    // Reconciliation finds it after all -- demonstrating why a TIMEOUT
    // must never be treated as a definite failure and auto-retried.
    const found = await adapter.findSalesOrderByExternalReference(submission.idempotencyKey);
    expect(found).not.toBeNull();
    expect(found!.sapDocEntry).toBeTruthy();

    const byDocEntry = await adapter.getSalesOrder(found!.sapDocEntry);
    expect(byDocEntry).toEqual(found);
  });

  it("getInvoice/getCreditNote return null for an unknown DocEntry", async () => {
    const adapter = new MockSapAdapter();
    expect(await adapter.getInvoice("no-such-doc-entry")).toBeNull();
    expect(await adapter.getCreditNote("no-such-doc-entry")).toBeNull();
  });
});

describe("SapAdapterError default retryability", () => {
  it("defaults NETWORK_UNAVAILABLE/TIMEOUT/SERVICE_UNAVAILABLE to retryable: true", () => {
    expect(new SapAdapterError("NETWORK_UNAVAILABLE", "x").retryable).toBe(true);
    expect(new SapAdapterError("TIMEOUT", "x").retryable).toBe(true);
    expect(new SapAdapterError("SERVICE_UNAVAILABLE", "x").retryable).toBe(true);
  });

  it("defaults every other category, including UNCERTAIN_SUBMISSION, to retryable: false", () => {
    expect(new SapAdapterError("UNCERTAIN_SUBMISSION", "x").retryable).toBe(false);
    expect(new SapAdapterError("VALIDATION_FAILURE", "x").retryable).toBe(false);
    expect(new SapAdapterError("MISSING_CUSTOMER_MAPPING", "x").retryable).toBe(false);
  });

  it("an explicit retryable option overrides the default", () => {
    expect(new SapAdapterError("VALIDATION_FAILURE", "x", { retryable: true }).retryable).toBe(true);
  });
});
