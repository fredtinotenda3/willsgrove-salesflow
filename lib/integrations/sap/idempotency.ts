/**
 * Milestone 9 (SAP Business One Integration). Deterministic idempotency
 * key for a SAP sales-order submission, keyed on `CustomerOrder.id`.
 *
 * Deliberately mirrors this project's own existing convention for this
 * exact problem rather than inventing a new one: lib/quotations/
 * convert-to-order.ts already derives a deterministic (non-random)
 * idempotencyKey of the shape `QUO-CONVERT-<quotationId>` for the same
 * reason -- "regenerating it on retry always matches the same row." This
 * key is computed fresh every time an order is (re-)submitted; it is
 * never stored anywhere except as IntegrationOperation.idempotencyKey
 * (the DB's own uniqueness constraint on that column is the actual
 * duplicate guard, not anything about this string's shape).
 */
export function buildSapSalesOrderIdempotencyKey(customerOrderId: string): string {
  return `SAP-SO-${customerOrderId}`;
}
